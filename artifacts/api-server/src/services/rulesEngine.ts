import {
  db,
  automationRulesTable,
  callRecordsTable,
  type AutomationRule,
  type CallRecord,
  type RuleAction,
  type RuleCondition,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { executeAction, type ActionExecutionResult } from "./actions";

const DEFAULT_RULES: Array<{
  name: string;
  conditions: RuleCondition;
  actions: RuleAction[];
}> = [
  {
    name: "Support calls → create ticket",
    conditions: { callType: "support" },
    actions: [{ type: "create_ticket" }],
  },
  {
    name: "Sales calls → create lead",
    conditions: { callType: "sales" },
    actions: [{ type: "create_lead" }],
  },
  {
    name: "Scheduling / follow-up calls → create task",
    conditions: { callType: ["scheduling", "follow-up"] },
    actions: [{ type: "create_task", dueInDays: 2 }],
  },
];

/**
 * Seed the default starter rules for a user the first time they have no rules.
 * Idempotent: only inserts if `automation_rules` is empty for this user.
 */
export async function ensureDefaultRules(userId: string): Promise<void> {
  const existing = await db
    .select({ id: automationRulesTable.id })
    .from(automationRulesTable)
    .where(eq(automationRulesTable.userId, userId))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(automationRulesTable).values(
    DEFAULT_RULES.map((r) => ({
      userId,
      name: r.name,
      triggerType: "call_analyzed",
      conditions: r.conditions,
      actions: r.actions,
      enabled: true,
      isDefault: true,
    })),
  );
}

function valueMatches(
  expected: string | string[] | undefined,
  actual: string | null | undefined,
): boolean {
  if (expected === undefined) return true;
  if (actual == null) return false;
  if (Array.isArray(expected)) {
    return expected.some(
      (v) => v.toLowerCase() === String(actual).toLowerCase(),
    );
  }
  return String(expected).toLowerCase() === String(actual).toLowerCase();
}

function tagMatches(
  expected: string | string[] | undefined,
  tags: string[] | null | undefined,
): boolean {
  if (expected === undefined) return true;
  const list = Array.isArray(tags) ? tags : [];
  const wanted = Array.isArray(expected) ? expected : [expected];
  return wanted.some((w) =>
    list.some((t) => t.toLowerCase() === w.toLowerCase()),
  );
}

export function callMatchesConditions(
  call: CallRecord,
  conditions: RuleCondition,
): boolean {
  if (!valueMatches(conditions.callType, call.callType)) return false;
  if (!valueMatches(conditions.intent, call.intent)) return false;
  if (!valueMatches(conditions.priority, call.priority)) return false;
  if (!valueMatches(conditions.sentiment, call.sentiment)) return false;
  if (!tagMatches(conditions.tagIncludes, call.suggestedTags)) return false;
  if (conditions.isDemo !== undefined) {
    const callIsDemo = call.isDemo === "true";
    if (callIsDemo !== conditions.isDemo) return false;
  }
  return true;
}

export interface RuleExecutionLogEntry {
  ruleId: string;
  ruleName: string;
  actionType: string;
  ok: boolean;
  message: string | null;
}

export interface RuleExecutionResult {
  rulesEvaluated: number;
  rulesMatched: number;
  actionsExecuted: number;
  log: RuleExecutionLogEntry[];
}

/**
 * Evaluate every enabled rule for the user against the given call. For each
 * matching rule, execute every action in order. Per-action errors are logged
 * and recorded in the result but never thrown — a single bad rule must not
 * stop the rest from running, and rule failures must not fail the call
 * pipeline that called us.
 */
export async function evaluateAndExecuteRules(args: {
  userId: string;
  call: CallRecord;
}): Promise<RuleExecutionResult> {
  const rules = await db
    .select()
    .from(automationRulesTable)
    .where(
      and(
        eq(automationRulesTable.userId, args.userId),
        eq(automationRulesTable.enabled, true),
      ),
    );

  const log: RuleExecutionLogEntry[] = [];
  let matched = 0;
  let executed = 0;

  for (const rule of rules as AutomationRule[]) {
    if (rule.triggerType !== "call_analyzed") continue;
    if (!callMatchesConditions(args.call, rule.conditions)) continue;
    matched += 1;

    for (const action of rule.actions) {
      const actionType = (action as RuleAction).type ?? "unknown";
      let result: ActionExecutionResult;
      try {
        result = await executeAction({
          userId: args.userId,
          call: args.call,
          rule,
          action,
        });
      } catch (err) {
        logger.error(
          { err, ruleId: rule.id, actionType },
          "Action execution threw",
        );
        result = {
          ok: false,
          message: err instanceof Error ? err.message : "Unknown error",
        };
      }
      if (result.ok) executed += 1;
      log.push({
        ruleId: rule.id,
        ruleName: rule.name,
        actionType,
        ok: result.ok,
        message: result.message ?? null,
      });
    }
  }

  return {
    rulesEvaluated: rules.length,
    rulesMatched: matched,
    actionsExecuted: executed,
    log,
  };
}

/**
 * For a single call (e.g. via "Run rules" UI button), make sure default rules
 * exist before evaluating — so brand-new accounts get a useful result.
 */
export async function runRulesWithDefaults(args: {
  userId: string;
  call: CallRecord;
}): Promise<RuleExecutionResult> {
  await ensureDefaultRules(args.userId);
  return evaluateAndExecuteRules(args);
}

// Re-export so the call pipeline can avoid importing both modules separately.
export { callRecordsTable };
