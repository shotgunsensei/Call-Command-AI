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
    const [updated] = await db
      .update(liveCallSessionsTable)
      .set({
        sessionStatus: "transferring",
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
      status: "attempted",
      reason:
        typeof body["reason"] === "string"
          ? String(body["reason"]).slice(0, 200)
          : "Operator-initiated transfer",
    });
    res.json(serialize(updated!));
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
