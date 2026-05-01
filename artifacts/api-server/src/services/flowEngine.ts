import {
  db,
  callFlowsTable,
  callRecordsTable,
  flowLogsTable,
  flowNodesTable,
  type CallFlow,
  type CallRecord,
  type FlowLog,
  type FlowNode,
  type InsertFlowLog,
} from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { executeAction, type Action } from "./actions";

export interface FlowExecutionResult {
  callId: string;
  flowId: string | null;
  flowName: string | null;
  nodesExecuted: number;
  actionsExecuted: number;
  endedAt: string | null;
  log: FlowLog[];
}

const MAX_STEPS = 50;

/**
 * Walk the flow node graph for the given (userId, call). For each node:
 *   - condition  → evaluates and branches via nextNodeId / nextNodeIdFalse
 *   - action     → dispatches to actions.executeAction
 *   - ai_decision → re-runs (or trusts) analysis and stamps fields onto call
 *   - route      → terminal: assign / escalate / end
 *
 * Every step is persisted to flow_logs. The walker hard-caps at MAX_STEPS
 * so a misconfigured loop can never starve the call pipeline.
 */
export async function executeFlowForCall(args: {
  userId: string;
  call: CallRecord;
  flow: CallFlow & { nodes?: FlowNode[] };
}): Promise<FlowExecutionResult> {
  const { userId, call, flow } = args;

  const nodes =
    flow.nodes ??
    (await db
      .select()
      .from(flowNodesTable)
      .where(eq(flowNodesTable.flowId, flow.id))
      .orderBy(asc(flowNodesTable.orderIndex)));

  if (nodes.length === 0) {
    return {
      callId: call.id,
      flowId: flow.id,
      flowName: flow.name,
      nodesExecuted: 0,
      actionsExecuted: 0,
      endedAt: null,
      log: [],
    };
  }

  const byId = new Map<string, FlowNode>();
  for (const n of nodes) byId.set(n.id, n);

  const startId = flow.startNodeId ?? nodes[0]!.id;
  let current: FlowNode | undefined = byId.get(startId) ?? nodes[0]!;
  const log: FlowLog[] = [];
  let nodesExecuted = 0;
  let actionsExecuted = 0;
  let endedAt: string | null = null;

  for (let step = 0; step < MAX_STEPS && current; step++) {
    const node = current;
    nodesExecuted += 1;
    let branch: string | null = null;
    let ok = true;
    let message: string | null = null;
    let detail: Record<string, unknown> | null = null;
    let nextId: string | null = node.nextNodeId ?? null;

    try {
      switch (node.type) {
        case "condition": {
          const cfg = normalizeConditionConfig(node.config);
          const matched = evaluateCondition(call, cfg);
          branch = matched ? "true" : "false";
          message = `${cfg.field ?? "?"} ${cfg.operator ?? "?"} ${JSON.stringify(cfg.value)} → ${branch}`;
          nextId = matched
            ? (node.nextNodeId ?? null)
            : (node.nextNodeIdFalse ?? null);
          break;
        }

        case "action": {
          // Accept either { actions: [...] } (UI default), { action: {...} },
          // or an inline action object so older configs keep working.
          const actions = extractActions(node.config);
          if (actions.length === 0) {
            ok = false;
            message = "No actions configured";
            detail = { actionType: "none" };
            break;
          }
          const results = [] as { type: string; ok: boolean; message?: string | null }[];
          let allOk = true;
          for (const action of actions) {
            const r = await executeAction({
              userId,
              call,
              action,
              context: {
                source: "flow",
                nodeId: node.id,
                nodeLabel: node.label,
              },
            });
            if (r.ok) actionsExecuted += 1;
            else allOk = false;
            results.push({ type: action.type, ok: r.ok, message: r.message ?? null });
          }
          ok = allOk;
          message = results.map((r) => `${r.type}:${r.ok ? "ok" : "fail"}`).join(", ");
          detail = { results };
          break;
        }

        case "ai_decision": {
          const cfg = normalizeAiDecisionConfig(node.config);
          if (cfg.copyAnalysis) {
            // Copy the analyzer's intent/priority/sentiment back onto the
            // call (and reflect in-memory). When the analyzer already
            // populated them this is a no-op write but the trace shows the
            // decision was applied.
            const decided = aiDecisionFor(call, cfg);
            await db
              .update(callRecordsTable)
              .set({
                intent: decided.intent,
                priority: decided.priority,
                sentiment: decided.sentiment,
              })
              .where(eq(callRecordsTable.id, call.id));
            call.intent = decided.intent;
            call.priority = decided.priority;
            call.sentiment = decided.sentiment;
            message = `copyAnalysis → intent=${decided.intent} priority=${decided.priority} sentiment=${decided.sentiment}`;
            detail = { copyAnalysis: true, ...decided };
          } else {
            // Decision-only mode: do not mutate the call, just record what
            // the engine would have decided so the trace is informative.
            const decided = aiDecisionFor(call, cfg);
            message = `decision (no copy): intent=${decided.intent} priority=${decided.priority} sentiment=${decided.sentiment}`;
            detail = { copyAnalysis: false, ...decided };
          }
          break;
        }

        case "route": {
          const cfg = normalizeRouteConfig(node.config);
          if (cfg.mode === "assign_user" && cfg.assigneeId) {
            await db
              .update(callRecordsTable)
              .set({ assignedUserId: cfg.assigneeId })
              .where(eq(callRecordsTable.id, call.id));
            call.assignedUserId = cfg.assigneeId;
            message = `Assigned to ${cfg.assigneeId}`;
          } else if (cfg.mode === "assign_queue") {
            message = `Queued: ${cfg.queue ?? "default"}`;
          } else if (cfg.mode === "escalate") {
            await db
              .update(callRecordsTable)
              .set({ priority: "urgent" })
              .where(eq(callRecordsTable.id, call.id));
            call.priority = "urgent";
            message = "Escalated to urgent";
          } else {
            message = "Flow ended";
          }
          branch = cfg.mode;
          detail = { mode: cfg.mode, assigneeId: cfg.assigneeId, queue: cfg.queue };
          // Route nodes are terminal regardless of nextNodeId.
          nextId = null;
          endedAt = new Date().toISOString();
          break;
        }

        default: {
          ok = false;
          message = `Unknown node type: ${node.type}`;
          nextId = null;
        }
      }
    } catch (err) {
      ok = false;
      message = err instanceof Error ? err.message : "Node execution threw";
      logger.warn({ err, nodeId: node.id, nodeType: node.type }, "Flow node threw");
      nextId = null;
    }

    const logRow: InsertFlowLog = {
      userId,
      callRecordId: call.id,
      flowId: flow.id,
      nodeId: node.id,
      nodeType: node.type,
      nodeLabel: node.label,
      branch,
      ok,
      message,
      detail: detail ?? undefined,
      stepIndex: String(step),
    };
    const [persisted] = await db
      .insert(flowLogsTable)
      .values(logRow)
      .returning();
    if (persisted) log.push(persisted);

    if (!nextId) {
      if (!endedAt) endedAt = new Date().toISOString();
      break;
    }
    current = byId.get(nextId);
    if (!current) {
      // Dangling pointer — log a synthetic terminal entry and stop.
      const [terminal] = await db
        .insert(flowLogsTable)
        .values({
          userId,
          callRecordId: call.id,
          flowId: flow.id,
          nodeType: "end",
          nodeLabel: "dangling next pointer",
          ok: false,
          message: `next_node_id ${nextId} not found in flow`,
          stepIndex: String(step + 1),
        })
        .returning();
      if (terminal) log.push(terminal);
      endedAt = new Date().toISOString();
      break;
    }
  }

  return {
    callId: call.id,
    flowId: flow.id,
    flowName: flow.name,
    nodesExecuted,
    actionsExecuted,
    endedAt,
    log,
  };
}

type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "in"
  | "exists"
  | "gt"
  | "lt";

interface ConditionConfig {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

interface AiDecisionConfig {
  copyAnalysis: boolean;
}

interface RouteConfig {
  mode: "assign_user" | "assign_queue" | "escalate" | "end";
  assigneeId?: string;
  queue?: string;
}

const OPERATOR_ALIASES: Record<string, ConditionOperator> = {
  equals: "equals",
  eq: "equals",
  "==": "equals",
  not_equals: "not_equals",
  neq: "not_equals",
  ne: "not_equals",
  "!=": "not_equals",
  contains: "contains",
  includes: "contains",
  has: "contains",
  in: "in",
  any_of: "in",
  exists: "exists",
  present: "exists",
  gt: "gt",
  ">": "gt",
  lt: "lt",
  "<": "lt",
};

function normalizeConditionConfig(raw: unknown): ConditionConfig {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const field = typeof obj.field === "string" ? obj.field : "";
  const rawOp = typeof obj.operator === "string" ? obj.operator : "equals";
  const operator = OPERATOR_ALIASES[rawOp] ?? "equals";
  return { field, operator, value: obj.value };
}

function normalizeAiDecisionConfig(raw: unknown): AiDecisionConfig {
  const obj = (raw ?? {}) as Record<string, unknown>;
  // Default to copying the analysis onto the call (matches UI default and
  // is the documented MVP behavior).
  const copyAnalysis = obj.copyAnalysis === false ? false : true;
  return { copyAnalysis };
}

const ROUTE_MODE_ALIASES: Record<string, RouteConfig["mode"]> = {
  assign_user: "assign_user",
  user: "assign_user",
  assign_queue: "assign_queue",
  queue: "assign_queue",
  escalate: "escalate",
  end: "end",
  hangup: "end",
  done: "end",
};

function normalizeRouteConfig(raw: unknown): RouteConfig {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawMode = typeof obj.mode === "string" ? obj.mode : "end";
  const mode = ROUTE_MODE_ALIASES[rawMode] ?? "end";
  const assigneeId =
    typeof obj.assigneeId === "string"
      ? obj.assigneeId
      : typeof obj.userId === "string"
        ? obj.userId
        : undefined;
  const queue = typeof obj.queue === "string" ? obj.queue : undefined;
  return { mode, assigneeId, queue };
}

/**
 * Action node config can take three shapes (UI uses the first):
 *   { actions: [{type, ...}, ...] }
 *   { action: {type, ...} }
 *   { type, ... }   // inline single action
 * Returned actions always have a string `type`; everything else is
 * passed through to the action engine.
 */
function extractActions(raw: unknown): Action[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (Array.isArray(obj.actions)) {
    return obj.actions
      .filter((a) => a && typeof a === "object" && typeof (a as { type?: unknown }).type === "string")
      .map((a) => a as Action);
  }
  if (
    obj.action &&
    typeof obj.action === "object" &&
    typeof (obj.action as { type?: unknown }).type === "string"
  ) {
    return [obj.action as Action];
  }
  if (typeof obj.type === "string") {
    return [obj as unknown as Action];
  }
  return [];
}

function readField(call: CallRecord, field: string): unknown {
  // Allow dotless access into the row + into known JSONB tag list.
  if (field === "tag" || field === "tags") return call.suggestedTags;
  return (call as unknown as Record<string, unknown>)[field];
}

function evaluateCondition(call: CallRecord, cfg: ConditionConfig): boolean {
  const got = readField(call, cfg.field);
  const expected = cfg.value;
  switch (cfg.operator) {
    case "equals":
      return String(got ?? "").toLowerCase() === String(expected ?? "").toLowerCase();
    case "not_equals":
      return String(got ?? "").toLowerCase() !== String(expected ?? "").toLowerCase();
    case "contains": {
      if (Array.isArray(got)) {
        return got.some(
          (v) => String(v).toLowerCase() === String(expected ?? "").toLowerCase(),
        );
      }
      return String(got ?? "")
        .toLowerCase()
        .includes(String(expected ?? "").toLowerCase());
    }
    case "in": {
      const list = Array.isArray(expected) ? expected : [expected];
      return list.some(
        (v) => String(v).toLowerCase() === String(got ?? "").toLowerCase(),
      );
    }
    case "exists":
      return got !== null && got !== undefined && got !== "";
    case "gt":
      return Number(got) > Number(expected);
    case "lt":
      return Number(got) < Number(expected);
    default:
      return false;
  }
}

/**
 * Lightweight AI decision used by the `ai_decision` node. If the call already
 * has analysis fields populated (from the audio pipeline) we trust them; if
 * not, we derive intent/priority/sentiment from a few transcript keywords.
 *
 * This intentionally does NOT call OpenAI again — the caller can opt into a
 * full re-analysis by pre-running the existing `processCallAudio` pipeline.
 */
function aiDecisionFor(
  call: CallRecord,
  _cfg: AiDecisionConfig,
): { intent: string; priority: string; sentiment: string } {
  const text = `${call.transcriptText ?? ""} ${call.summary ?? ""}`.toLowerCase();
  const intent =
    call.intent ??
    (text.match(/cancel|refund|angry|broken|bug|crash|urgent/) ? "support"
      : text.match(/buy|price|demo|trial|interested|quote/) ? "sales"
      : text.match(/schedule|appointment|reschedule|book|calendar/) ? "scheduling"
      : "general");
  const priority =
    call.priority ??
    (text.match(/urgent|asap|immediately|critical/) ? "urgent"
      : text.match(/important|priority|today/) ? "high"
      : "medium");
  const sentiment =
    call.sentiment ??
    (text.match(/angry|frustrated|disappointed|terrible|hate|worst/)
      ? "negative"
      : text.match(/happy|love|great|amazing|perfect|thank you|thanks/)
        ? "positive"
        : "neutral");
  return { intent, priority, sentiment };
}

/**
 * Resolve the active flow for a given (userId, channelId) tuple. Returns the
 * single channel-bound active flow if one exists, otherwise the user's
 * default (channelId = NULL) active flow, otherwise null.
 */
export async function resolveActiveFlowFor(
  userId: string,
  channelId: string | null,
): Promise<(CallFlow & { nodes: FlowNode[] }) | null> {
  if (channelId) {
    const [byChannel] = await db
      .select()
      .from(callFlowsTable)
      .where(
        and(
          eq(callFlowsTable.userId, userId),
          eq(callFlowsTable.channelId, channelId),
          eq(callFlowsTable.isActive, true),
        ),
      )
      .limit(1);
    if (byChannel) {
      const nodes = await db
        .select()
        .from(flowNodesTable)
        .where(eq(flowNodesTable.flowId, byChannel.id))
        .orderBy(asc(flowNodesTable.orderIndex));
      return { ...byChannel, nodes };
    }
  }
  // Fall back to a user-default flow (no channel binding). MUST require
  // channel_id IS NULL so a call without a matching channel-bound flow
  // never accidentally runs another channel's flow.
  const [fallback] = await db
    .select()
    .from(callFlowsTable)
    .where(
      and(
        eq(callFlowsTable.userId, userId),
        eq(callFlowsTable.isActive, true),
        isNull(callFlowsTable.channelId),
      ),
    )
    .limit(1);
  if (!fallback) return null;
  const nodes = await db
    .select()
    .from(flowNodesTable)
    .where(eq(flowNodesTable.flowId, fallback.id))
    .orderBy(asc(flowNodesTable.orderIndex));
  return { ...fallback, nodes };
}
