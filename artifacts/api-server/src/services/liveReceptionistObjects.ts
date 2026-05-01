/**
 * Helper for creating business objects (ticket/lead/task) from a live
 * receptionist decision. De-duplicates per-session via
 * `liveCallSessionsTable.createdObjectIds` so a noisy AI loop or a Twilio
 * gather retry can never create two tickets for the same call.
 *
 * Splitting this out from the gather route keeps that handler short and
 * lets the live-call simulator share the exact same path.
 */
import {
  db,
  liveCallSessionsTable,
  ticketsTable,
  leadsTable,
  tasksTable,
  type LiveCallSession,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import type { ReceptionistDecision } from "./liveReceptionist";
import { logger } from "../lib/logger";

export type CreatableObjectKind = "ticket" | "lead" | "task";

const ACTION_TO_KIND: Record<string, CreatableObjectKind | null> = {
  create_ticket: "ticket",
  create_lead: "lead",
  create_task: "task",
};

function priorityToObjectPriority(
  p: ReceptionistDecision["priority"],
): "low" | "medium" | "high" | "urgent" {
  if (p === "emergency") return "urgent";
  if (p === "high") return "high";
  if (p === "low") return "low";
  return "medium";
}

function pickName(
  collected: Record<string, unknown>,
  fallbackPhone: string | null,
): string {
  const candidates = ["caller_name", "name", "customer_name", "contact_name"];
  for (const k of candidates) {
    const v = collected[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
  }
  return (fallbackPhone ?? "Unknown caller").slice(0, 200);
}

function pickCompany(collected: Record<string, unknown>): string | null {
  const v = collected["company"] ?? collected["company_name"] ?? collected["account_name"];
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;
}

function buildTitle(decision: ReceptionistDecision, fallback: string): string {
  const intent = decision.intent?.trim();
  return (intent && intent.length > 0 ? intent : fallback).slice(0, 280);
}

function buildDescription(
  session: LiveCallSession,
  decision: ReceptionistDecision,
): string {
  const lines: string[] = [];
  if (decision.intent) lines.push(`Intent: ${decision.intent}`);
  if (decision.reason) lines.push(`Reason: ${decision.reason}`);
  if (Object.keys(session.collectedData ?? {}).length > 0) {
    lines.push("Collected:");
    for (const [k, v] of Object.entries(session.collectedData)) {
      lines.push(`- ${k}: ${String(v)}`);
    }
  }
  if (session.transcriptLive) {
    lines.push("");
    lines.push("Transcript:");
    lines.push(session.transcriptLive.slice(-1500));
  }
  return lines.join("\n").slice(0, 4000);
}

/**
 * Idempotently create the requested object for this live session.
 * Returns the object id (existing or newly-created), or null when the
 * action isn't a create-* kind.
 */
export async function createObjectForSession(args: {
  session: LiveCallSession;
  decision: ReceptionistDecision;
}): Promise<{ kind: CreatableObjectKind; id: string } | null> {
  const { session, decision } = args;
  const kind = ACTION_TO_KIND[decision.recommendedAction];
  if (!kind) return null;

  const existingId = (session.createdObjectIds ?? {})[kind];
  if (existingId) {
    return { kind, id: existingId };
  }

  const collected = session.collectedData ?? {};
  const callerName = pickName(collected, session.callerPhone);
  const company = pickCompany(collected);
  const priority = priorityToObjectPriority(decision.priority);

  let createdId: string | null = null;
  try {
    if (kind === "ticket") {
      const [row] = await db
        .insert(ticketsTable)
        .values({
          userId: session.userId,
          title: buildTitle(decision, `Inbound call from ${callerName}`),
          description: buildDescription(session, decision),
          priority,
          status: "open",
          linkedCallId: session.callRecordId,
        })
        .returning({ id: ticketsTable.id });
      createdId = row?.id ?? null;
    } else if (kind === "lead") {
      const [row] = await db
        .insert(leadsTable)
        .values({
          userId: session.userId,
          name: callerName,
          phone: session.callerPhone,
          company,
          intent: decision.intent || null,
          status: "new",
          linkedCallId: session.callRecordId,
        })
        .returning({ id: leadsTable.id });
      createdId = row?.id ?? null;
    } else if (kind === "task") {
      const [row] = await db
        .insert(tasksTable)
        .values({
          userId: session.userId,
          title: buildTitle(decision, `Follow-up: ${callerName}`),
          description: buildDescription(session, decision),
          status: "open",
          linkedCallId: session.callRecordId,
        })
        .returning({ id: tasksTable.id });
      createdId = row?.id ?? null;
    }
  } catch (err) {
    logger.warn(
      { err, kind, sessionId: session.id },
      "Failed to create live-session object",
    );
    return null;
  }

  if (!createdId) return null;

  const next = { ...(session.createdObjectIds ?? {}), [kind]: createdId };
  await db
    .update(liveCallSessionsTable)
    .set({ createdObjectIds: next })
    .where(eq(liveCallSessionsTable.id, session.id));
  return { kind, id: createdId };
}
