import {
  db,
  callRecordsTable,
  integrationsTable,
  leadsTable,
  tasksTable,
  ticketsTable,
  type CallRecord,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { safeFetchWebhook } from "../lib/safeWebhook";
import { logger } from "../lib/logger";

/**
 * Discriminated descriptor for every action that can be invoked by an
 * automation rule OR a flow engine `action` node.
 *
 * Adding a new action type requires:
 *   1) extending this union, and
 *   2) adding a matching `case` in `executeAction()`.
 *
 * Because actions ride on JSONB columns we use `Record<string, unknown>` for
 * the call-site shape and validate at runtime here.
 */
export type Action =
  | { type: "create_ticket"; titleTemplate?: string }
  | { type: "create_lead" }
  | { type: "create_task"; titleTemplate?: string; dueInDays?: number }
  | { type: "send_webhook"; integrationId?: string; url?: string }
  | { type: "send_slack"; integrationId: string; messageTemplate?: string }
  | { type: "send_email"; to: string; subjectTemplate?: string }
  | { type: "assign_user"; assigneeId: string }
  | { type: "mark_priority"; priority: "low" | "medium" | "high" | "urgent" };

export interface ActionExecutionResult {
  ok: boolean;
  message?: string;
}

/** Caller-supplied context used for trace metadata in the rule/flow log. */
export interface ActionContext {
  ruleId?: string;
  ruleName?: string;
  nodeId?: string;
  nodeLabel?: string | null;
  source: "rule" | "flow";
}

function renderTemplate(
  tpl: string | undefined,
  fallback: string,
  call: CallRecord,
): string {
  const t = tpl ?? fallback;
  return t
    .replace(/\{customerName\}/g, call.customerName ?? "Customer")
    .replace(/\{companyName\}/g, call.companyName ?? "")
    .replace(/\{intent\}/g, call.intent ?? "follow up")
    .replace(/\{filename\}/g, call.originalFilename ?? "call")
    .replace(/\{summary\}/g, (call.summary ?? "").slice(0, 280));
}

function callPriorityToTicketPriority(
  p: string | null | undefined,
): "low" | "medium" | "high" | "urgent" {
  if (p === "low" || p === "medium" || p === "high" || p === "urgent") return p;
  return "medium";
}

export async function executeAction(args: {
  userId: string;
  call: CallRecord;
  action: Action;
  context: ActionContext;
}): Promise<ActionExecutionResult> {
  const { userId, call, action, context } = args;

  switch (action.type) {
    case "create_ticket": {
      const title = renderTemplate(
        action.titleTemplate,
        "{intent} — {customerName}",
        call,
      );
      const description = call.summary ?? call.intent ?? null;
      const [row] = await db
        .insert(ticketsTable)
        .values({
          userId,
          title: title.slice(0, 280),
          description,
          priority: callPriorityToTicketPriority(call.priority),
          status: "open",
          linkedCallId: call.id,
          createdByRuleId: context.ruleId,
        })
        .returning({ id: ticketsTable.id });
      return { ok: true, message: `Ticket ${row?.id ?? ""} created` };
    }

    case "create_lead": {
      const name =
        call.customerName ??
        call.companyName ??
        call.callerPhone ??
        "Unknown caller";
      const [row] = await db
        .insert(leadsTable)
        .values({
          userId,
          name: name.slice(0, 200),
          phone: call.callerPhone ?? null,
          company: call.companyName ?? null,
          intent: call.intent ?? null,
          status: "new",
          linkedCallId: call.id,
          createdByRuleId: context.ruleId,
        })
        .returning({ id: leadsTable.id });
      return { ok: true, message: `Lead ${row?.id ?? ""} created` };
    }

    case "create_task": {
      const title = renderTemplate(
        action.titleTemplate,
        "Follow up: {intent}",
        call,
      );
      const dueInDays = Number(action.dueInDays ?? 2);
      const due = Number.isFinite(dueInDays)
        ? new Date(Date.now() + dueInDays * 24 * 60 * 60 * 1000)
        : null;
      const [row] = await db
        .insert(tasksTable)
        .values({
          userId,
          title: title.slice(0, 280),
          description: call.summary ?? null,
          dueDate: due,
          status: "open",
          linkedCallId: call.id,
          createdByRuleId: context.ruleId,
        })
        .returning({ id: tasksTable.id });
      return { ok: true, message: `Task ${row?.id ?? ""} created` };
    }

    case "send_webhook": {
      let webhookUrl: string | null = null;
      if (action.integrationId) {
        const [integration] = await db
          .select()
          .from(integrationsTable)
          .where(
            and(
              eq(integrationsTable.id, action.integrationId),
              eq(integrationsTable.userId, userId),
            ),
          )
          .limit(1);
        if (!integration) {
          return { ok: false, message: "Integration not found" };
        }
        if (!integration.enabled) {
          return { ok: false, message: "Integration disabled" };
        }
        webhookUrl = integration.webhookUrl;
      } else if (action.url) {
        webhookUrl = action.url;
      } else {
        return {
          ok: false,
          message: "send_webhook requires integrationId or url",
        };
      }
      try {
        const res = await safeFetchWebhook(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "callcommand",
            trigger: context.source,
            rule: context.ruleId
              ? { id: context.ruleId, name: context.ruleName }
              : undefined,
            node: context.nodeId
              ? { id: context.nodeId, label: context.nodeLabel }
              : undefined,
            call: serializeCall(call),
          }),
        });
        return {
          ok: res.ok,
          message: res.ok
            ? `Webhook responded ${res.status}`
            : `Webhook failed ${res.status}`,
        };
      } catch (err) {
        logger.warn({ err }, "send_webhook action failed");
        return {
          ok: false,
          message: err instanceof Error ? err.message : "Network error",
        };
      }
    }

    case "send_slack": {
      // Slack delivery is implemented as an outbound webhook against an
      // integration row of type "slack" whose webhookUrl is the Slack
      // incoming webhook. We never call slack APIs directly to keep secrets
      // out of code.
      const [integration] = await db
        .select()
        .from(integrationsTable)
        .where(
          and(
            eq(integrationsTable.id, action.integrationId),
            eq(integrationsTable.userId, userId),
          ),
        )
        .limit(1);
      if (!integration) {
        return { ok: false, message: "Slack integration not found" };
      }
      if (!integration.enabled) {
        return { ok: false, message: "Slack integration disabled" };
      }
      const message = renderTemplate(
        action.messageTemplate,
        ":telephone_receiver: *{customerName}* — {intent}\n>{summary}",
        call,
      );
      try {
        const res = await safeFetchWebhook(integration.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        });
        return {
          ok: res.ok,
          message: res.ok
            ? `Slack accepted (${res.status})`
            : `Slack rejected (${res.status})`,
        };
      } catch (err) {
        logger.warn({ err }, "send_slack failed");
        return {
          ok: false,
          message: err instanceof Error ? err.message : "Network error",
        };
      }
    }

    case "send_email": {
      // No outbound SMTP is wired in this MVP — record the request as a
      // followup_log via the followups route is the canonical path. Here we
      // just *log* the intent so the rule/flow trace is honest. Wire a
      // send_webhook to your transactional email provider for real delivery.
      const subject = renderTemplate(
        action.subjectTemplate,
        "Follow-up: {customerName}",
        call,
      );
      logger.info(
        { to: action.to, subject, callId: call.id },
        "send_email action requested (no SMTP configured — logged only)",
      );
      return {
        ok: true,
        message: `Email queued (logged only) → ${action.to}`,
      };
    }

    case "assign_user": {
      // Stamp the assignee onto the call AND any tickets linked to it.
      await db
        .update(callRecordsTable)
        .set({ assignedUserId: action.assigneeId })
        .where(eq(callRecordsTable.id, call.id));
      await db
        .update(ticketsTable)
        .set({ assignedUserId: action.assigneeId })
        .where(
          and(
            eq(ticketsTable.userId, userId),
            eq(ticketsTable.linkedCallId, call.id),
          ),
        );
      return { ok: true, message: `Assigned to ${action.assigneeId}` };
    }

    case "mark_priority": {
      await db
        .update(callRecordsTable)
        .set({ priority: action.priority })
        .where(eq(callRecordsTable.id, call.id));
      // Mutate in-memory call so subsequent flow nodes see the new value.
      call.priority = action.priority;
      return { ok: true, message: `Priority set to ${action.priority}` };
    }

    default: {
      const exhaustive: never = action;
      void exhaustive;
      return { ok: false, message: "Unknown action type" };
    }
  }
}

function serializeCall(call: CallRecord): Record<string, unknown> {
  return {
    id: call.id,
    customerName: call.customerName,
    companyName: call.companyName,
    callerPhone: call.callerPhone,
    callType: call.callType,
    intent: call.intent,
    priority: call.priority,
    sentiment: call.sentiment,
    summary: call.summary,
    suggestedTags: call.suggestedTags,
    followUpMessage: call.followUpMessage,
    channelId: call.channelId,
    createdAt: call.createdAt.toISOString(),
  };
}
