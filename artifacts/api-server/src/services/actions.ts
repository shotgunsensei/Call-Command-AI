import {
  db,
  integrationsTable,
  leadsTable,
  tasksTable,
  ticketsTable,
  type AutomationRule,
  type CallRecord,
  type RuleAction,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { safeFetchWebhook } from "../lib/safeWebhook";
import { logger } from "../lib/logger";

export interface ActionExecutionResult {
  ok: boolean;
  message?: string;
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
    .replace(/\{filename\}/g, call.originalFilename ?? "call");
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
  rule: AutomationRule;
  action: RuleAction;
}): Promise<ActionExecutionResult> {
  const { userId, call, rule, action } = args;

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
          createdByRuleId: rule.id,
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
          createdByRuleId: rule.id,
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
          createdByRuleId: rule.id,
        })
        .returning({ id: tasksTable.id });
      return { ok: true, message: `Task ${row?.id ?? ""} created` };
    }

    case "send_webhook": {
      const integrationId = action.integrationId;
      if (!integrationId) {
        return { ok: false, message: "send_webhook requires integrationId" };
      }
      const [integration] = await db
        .select()
        .from(integrationsTable)
        .where(
          and(
            eq(integrationsTable.id, integrationId),
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
      try {
        const res = await safeFetchWebhook(integration.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "callcommand",
            trigger: "automation_rule",
            rule: { id: rule.id, name: rule.name },
            integration: { id: integration.id, type: integration.type },
            call: {
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
              createdAt: call.createdAt.toISOString(),
            },
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

    default: {
      const exhaustive: never = action;
      void exhaustive;
      return { ok: false, message: `Unknown action type` };
    }
  }
}
