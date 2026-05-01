import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  liveCallSessionsTable,
  callRecordsTable,
  transferTargetsTable,
  transferLogsTable,
  type LiveCallSession,
  type LiveSessionNote,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  redirectLiveCallToDial,
  redirectStatusToTransferLog,
} from "../services/twilioControl";
import { getWebhookBaseUrl } from "../lib/twilio";

const router: IRouter = Router();

function serialize(s: LiveCallSession) {
  return {
    ...s,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

async function loadOwned(
  userId: string,
  id: string,
): Promise<LiveCallSession | null> {
  const [row] = await db
    .select()
    .from(liveCallSessionsTable)
    .where(
      and(
        eq(liveCallSessionsTable.id, id),
        eq(liveCallSessionsTable.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

router.get(
  "/live-sessions",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(liveCallSessionsTable)
      .where(eq(liveCallSessionsTable.userId, userId))
      .orderBy(desc(liveCallSessionsTable.startedAt))
      .limit(100);
    res.json(rows.map(serialize));
  },
);

router.get(
  "/live-sessions/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const row = await loadOwned(userId, String(req.params.id));
    if (!row) {
      res.status(404).json({ error: "Live session not found" });
      return;
    }
    res.json(serialize(row));
  },
);

router.post(
  "/live-sessions/:id/mark-urgent",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const session = await loadOwned(userId, id);
    if (!session) {
      res.status(404).json({ error: "Live session not found" });
      return;
    }
    const [updated] = await db
      .update(liveCallSessionsTable)
      .set({
        priority: "emergency",
        escalationReason:
          session.escalationReason ?? "Manually marked urgent by operator",
      })
      .where(eq(liveCallSessionsTable.id, id))
      .returning();
    // Mirror to call_records so existing dashboards reflect the urgency.
    if (session.callRecordId) {
      await db
        .update(callRecordsTable)
        .set({ priority: "urgent" })
        .where(eq(callRecordsTable.id, session.callRecordId));
    }
    res.json(serialize(updated!));
  },
);

router.post(
  "/live-sessions/:id/transfer",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const targetId = typeof body["targetId"] === "string" ? body["targetId"] : null;
    if (!targetId) {
      res.status(400).json({ error: "targetId is required" });
      return;
    }
    const session = await loadOwned(userId, id);
    if (!session) {
      res.status(404).json({ error: "Live session not found" });
      return;
    }
    const [target] = await db
      .select()
      .from(transferTargetsTable)
      .where(
        and(
          eq(transferTargetsTable.id, targetId),
          eq(transferTargetsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Transfer target not found" });
      return;
    }

    const reason =
      typeof body["reason"] === "string"
        ? String(body["reason"]).slice(0, 200)
        : "Operator-initiated transfer";

    // Try to redirect the live call via the Twilio Calls REST API. The
    // helper returns a structured result so we can write an honest
    // transfer_log status (`redirected` / `logged_no_provider` / `failed`)
    // instead of unconditionally claiming "attempted".
    const base = getWebhookBaseUrl();
    const redirect = await redirectLiveCallToDial({
      callSid: session.providerCallSid,
      targetPhoneE164: target.phoneNumber,
      sayText: "Connecting your call now.",
      recordCalls: true,
      statusCallbackUrl: base ? `${base}/api/twilio/voice/status` : null,
      recordingCallbackUrl: base ? `${base}/api/twilio/voice/recording` : null,
    });

    // The session moves to "transferring" only when the redirect actually
    // landed at Twilio. For logged-only outcomes the session stays where
    // it was so an operator can decide what to do next without the UI
    // misrepresenting a successful bridge.
    const [updated] = await db
      .update(liveCallSessionsTable)
      .set({
        ...(redirect.ok ? { sessionStatus: "transferring" as const } : {}),
        transferTarget: target.name,
      })
      .where(eq(liveCallSessionsTable.id, id))
      .returning();

    await db.insert(transferLogsTable).values({
      userId,
      callRecordId: session.callRecordId,
      liveSessionId: session.id,
      targetId: target.id,
      targetName: target.name,
      // Persist the coarse audit status (bridged/failed) plus the rich
      // redirect status in `reason` so operators can see whether Twilio
      // was wired up or not.
      status: redirectStatusToTransferLog(redirect.status),
      reason: `${reason} — [${redirect.status}] ${redirect.reason}`,
    });

    if (!redirect.ok) {
      // 202 for "we logged your intent but no live redirect happened"
      // (Twilio not configured / non-Twilio session). 502 for actual
      // upstream Twilio failures so the UI can surface a real error.
      const httpStatus =
        redirect.status === "logged_no_provider" ||
        redirect.status === "no_call_sid" ||
        redirect.status === "no_target_phone"
          ? 202
          : 502;
      res.status(httpStatus).json({
        ok: false,
        transferStatus: redirect.status,
        reason: redirect.reason,
        session: serialize(updated!),
      });
      return;
    }

    res.json({
      ok: true,
      transferStatus: redirect.status,
      ...serialize(updated!),
    });
  },
);

router.post(
  "/live-sessions/:id/end",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const session = await loadOwned(userId, id);
    if (!session) {
      res.status(404).json({ error: "Live session not found" });
      return;
    }
    const [updated] = await db
      .update(liveCallSessionsTable)
      .set({
        sessionStatus: "completed",
        endedAt: new Date(),
      })
      .where(eq(liveCallSessionsTable.id, id))
      .returning();
    res.json(serialize(updated!));
  },
);

router.post(
  "/live-sessions/:id/add-note",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const noteBody = typeof body["body"] === "string" ? body["body"].trim() : "";
    if (!noteBody) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const session = await loadOwned(userId, id);
    if (!session) {
      res.status(404).json({ error: "Live session not found" });
      return;
    }
    const note: LiveSessionNote = {
      authorUserId: userId,
      body: noteBody.slice(0, 2000),
      createdAt: new Date().toISOString(),
    };
    const nextNotes: LiveSessionNote[] = [...(session.notes ?? []), note];
    const [updated] = await db
      .update(liveCallSessionsTable)
      .set({ notes: nextNotes })
      .where(eq(liveCallSessionsTable.id, id))
      .returning();
    res.json(serialize(updated!));
  },
);

export default router;
