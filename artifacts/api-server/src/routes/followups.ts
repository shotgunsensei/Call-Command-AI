import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  callRecordsTable,
  followupLogsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

function serialize(
  row: typeof followupLogsTable.$inferSelect,
): Record<string, unknown> {
  return { ...row, sentAt: row.sentAt.toISOString() };
}

router.get(
  "/follow-ups",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(followupLogsTable)
      .where(eq(followupLogsTable.userId, userId))
      .orderBy(desc(followupLogsTable.sentAt))
      .limit(500);
    res.json(rows.map(serialize));
  },
);

router.post(
  "/calls/:id/follow-up",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const [call] = await db
      .select()
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.id, id),
          eq(callRecordsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!call) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    const body = req.body ?? {};
    const message =
      typeof body["message"] === "string" && body["message"].trim()
        ? String(body["message"]).slice(0, 5000)
        : (call.followUpMessage ?? "");
    if (!message.trim()) {
      res
        .status(400)
        .json({ error: "No follow-up message available for this call" });
      return;
    }
    const recipient =
      typeof body["recipient"] === "string"
        ? body["recipient"].slice(0, 200)
        : (call.callerPhone ?? null);
    const subject =
      typeof body["subject"] === "string"
        ? body["subject"].slice(0, 200)
        : `Follow-up from your call`;

    // We do not actually send email — this is a logged "send" record. When a
    // user wires up a real SMS/email provider via integrations, they can use a
    // send_webhook automation rule to deliver these.
    const [row] = await db
      .insert(followupLogsTable)
      .values({
        userId,
        callRecordId: call.id,
        channel: "log",
        recipient,
        subject,
        message,
        status: "sent",
      })
      .returning();
    res.json(serialize(row!));
  },
);

export default router;
