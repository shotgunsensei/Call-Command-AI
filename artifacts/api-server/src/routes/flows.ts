import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  callFlowsTable,
  flowNodesTable,
  type CallFlow,
  type FlowNode,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

interface NodeDraft {
  type: string;
  label?: string | null;
  config?: Record<string, unknown>;
  ref?: string | null;
  nextNodeRef?: string | null;
  nextNodeFalseRef?: string | null;
}

function serialize(flow: CallFlow, nodes: FlowNode[]) {
  return {
    ...flow,
    nodes,
    createdAt: flow.createdAt.toISOString(),
    updatedAt: flow.updatedAt.toISOString(),
  };
}

async function loadFlow(
  userId: string,
  id: string,
): Promise<{ flow: CallFlow; nodes: FlowNode[] } | null> {
  const [flow] = await db
    .select()
    .from(callFlowsTable)
    .where(and(eq(callFlowsTable.id, id), eq(callFlowsTable.userId, userId)))
    .limit(1);
  if (!flow) return null;
  const nodes = await db
    .select()
    .from(flowNodesTable)
    .where(eq(flowNodesTable.flowId, flow.id))
    .orderBy(asc(flowNodesTable.orderIndex));
  return { flow, nodes };
}

/**
 * Replace the entire node set for a flow. We use ref-based pointers
 * (`ref`, `nextNodeRef`, `nextNodeFalseRef`) so the client can describe
 * graphs without round-tripping for IDs. After insert we resolve refs to
 * actual UUIDs and stamp them onto the flow's `start_node_id` and each
 * node's `next_node_id` / `next_node_id_false`.
 */
async function replaceNodes(
  flowId: string,
  drafts: NodeDraft[],
): Promise<{ nodes: FlowNode[]; startNodeId: string | null }> {
  await db.delete(flowNodesTable).where(eq(flowNodesTable.flowId, flowId));
  if (drafts.length === 0) return { nodes: [], startNodeId: null };

  const inserted = await db
    .insert(flowNodesTable)
    .values(
      drafts.map((d, idx) => ({
        flowId,
        type: d.type,
        label: d.label ?? null,
        config: (d.config ?? {}) as Record<string, unknown>,
        orderIndex: idx,
      })),
    )
    .returning();

  // Map ref string → uuid. Refs default to "n0"/"n1"/... when unspecified.
  const refToId = new Map<string, string>();
  drafts.forEach((d, idx) => {
    refToId.set(d.ref ?? `n${idx}`, inserted[idx]!.id);
    refToId.set(String(idx), inserted[idx]!.id);
  });

  // Second pass: stamp pointers.
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i]!;
    const node = inserted[i]!;
    const nextId = draft.nextNodeRef
      ? (refToId.get(draft.nextNodeRef) ?? null)
      : i + 1 < inserted.length
        ? inserted[i + 1]!.id
        : null;
    const nextIdFalse = draft.nextNodeFalseRef
      ? (refToId.get(draft.nextNodeFalseRef) ?? null)
      : null;
    if (nextId !== node.nextNodeId || nextIdFalse !== node.nextNodeIdFalse) {
      await db
        .update(flowNodesTable)
        .set({ nextNodeId: nextId, nextNodeIdFalse: nextIdFalse })
        .where(eq(flowNodesTable.id, node.id));
    }
  }

  const final = await db
    .select()
    .from(flowNodesTable)
    .where(eq(flowNodesTable.flowId, flowId))
    .orderBy(asc(flowNodesTable.orderIndex));
  return { nodes: final, startNodeId: final[0]?.id ?? null };
}

router.get(
  "/flows",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const flows = await db
      .select()
      .from(callFlowsTable)
      .where(eq(callFlowsTable.userId, userId))
      .orderBy(asc(callFlowsTable.createdAt));
    if (flows.length === 0) {
      res.json([]);
      return;
    }
    // Scope node read to this user's flows only — never SELECT the entire
    // flow_nodes table across tenants.
    const ownedIds = flows.map((f) => f.id);
    const ownedNodes = await db
      .select()
      .from(flowNodesTable)
      .where(inArray(flowNodesTable.flowId, ownedIds))
      .orderBy(asc(flowNodesTable.orderIndex));
    const byFlow = new Map<string, FlowNode[]>();
    for (const n of ownedNodes) {
      const arr = byFlow.get(n.flowId) ?? [];
      arr.push(n);
      byFlow.set(n.flowId, arr);
    }
    res.json(flows.map((f) => serialize(f, byFlow.get(f.id) ?? [])));
  },
);

router.get(
  "/flows/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const loaded = await loadFlow(userId, id);
    if (!loaded) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }
    res.json(serialize(loaded.flow, loaded.nodes));
  },
);

router.post(
  "/flows",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const [created] = await db
      .insert(callFlowsTable)
      .values({
        userId,
        name: name.slice(0, 200),
        description:
          typeof body.description === "string" ? body.description : null,
        channelId:
          typeof body.channelId === "string" ? body.channelId : null,
        isActive: body.isActive === false ? false : true,
      })
      .returning();
    const drafts = Array.isArray(body.nodes) ? (body.nodes as NodeDraft[]) : [];
    const { nodes, startNodeId } = await replaceNodes(created!.id, drafts);
    if (startNodeId) {
      await db
        .update(callFlowsTable)
        .set({ startNodeId })
        .where(eq(callFlowsTable.id, created!.id));
      created!.startNodeId = startNodeId;
    }
    res.status(201).json(serialize(created!, nodes));
  },
);

router.patch(
  "/flows/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<CallFlow> = {};
    if (typeof body.name === "string") patch.name = body.name.slice(0, 200);
    if ("description" in body)
      patch.description =
        typeof body.description === "string" ? body.description : null;
    if ("channelId" in body)
      patch.channelId =
        typeof body.channelId === "string" ? body.channelId : null;
    if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
    const [updated] = await db
      .update(callFlowsTable)
      .set(patch)
      .where(
        and(eq(callFlowsTable.id, id), eq(callFlowsTable.userId, userId)),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }
    let nodes: FlowNode[] = [];
    if (Array.isArray(body.nodes)) {
      const result = await replaceNodes(updated.id, body.nodes as NodeDraft[]);
      nodes = result.nodes;
      await db
        .update(callFlowsTable)
        .set({ startNodeId: result.startNodeId })
        .where(eq(callFlowsTable.id, updated.id));
      updated.startNodeId = result.startNodeId;
    } else {
      nodes = await db
        .select()
        .from(flowNodesTable)
        .where(eq(flowNodesTable.flowId, updated.id))
        .orderBy(asc(flowNodesTable.orderIndex));
    }
    res.json(serialize(updated, nodes));
  },
);

router.delete(
  "/flows/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    // Authz FIRST: confirm the flow exists and belongs to this user before
    // touching any rows. Without this an attacker who guessed a flow id
    // could delete another tenant's flow_nodes even though the flow row
    // delete would no-op.
    const [owned] = await db
      .select({ id: callFlowsTable.id })
      .from(callFlowsTable)
      .where(and(eq(callFlowsTable.id, id), eq(callFlowsTable.userId, userId)))
      .limit(1);
    if (!owned) {
      res.status(404).json({ error: "Flow not found" });
      return;
    }
    await db.delete(flowNodesTable).where(eq(flowNodesTable.flowId, id));
    await db
      .delete(callFlowsTable)
      .where(and(eq(callFlowsTable.id, id), eq(callFlowsTable.userId, userId)));
    res.status(204).send();
  },
);

export default router;
