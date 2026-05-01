import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  channelsTable,
  callRecordsTable,
  callFlowsTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

/**
 * GET /api/switchboard
 *
 * Returns each channel for the workspace bucketed with its recent (last
 * 24h) calls. Designed for a dashboard that polls every 5–10 seconds —
 * keep the payload bounded (max 25 calls per channel).
 */
router.get(
  "/switchboard",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;

    const channels = await db
      .select()
      .from(channelsTable)
      .where(eq(channelsTable.userId, userId))
      .orderBy(asc(channelsTable.createdAt));

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const calls = await db
      .select()
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.userId, userId),
          gte(callRecordsTable.createdAt, since),
        ),
      )
      .orderBy(desc(callRecordsTable.createdAt))
      .limit(500);

    // Optional flow assignment so the UI can show "Flow: X" per channel.
    const flows = await db
      .select({
        id: callFlowsTable.id,
        name: callFlowsTable.name,
        channelId: callFlowsTable.channelId,
        isActive: callFlowsTable.isActive,
      })
      .from(callFlowsTable)
      .where(
        and(
          eq(callFlowsTable.userId, userId),
          eq(callFlowsTable.isActive, true),
        ),
      );
    const flowByChannel = new Map<string, { id: string; name: string }>();
    for (const f of flows) {
      if (f.channelId && !flowByChannel.has(f.channelId)) {
        flowByChannel.set(f.channelId, { id: f.id, name: f.name });
      }
    }

    const callsByChannel = new Map<string, typeof calls>();
    const orphanCalls: typeof calls = [];
    for (const c of calls) {
      if (!c.channelId) {
        orphanCalls.push(c);
        continue;
      }
      const arr = callsByChannel.get(c.channelId) ?? [];
      if (arr.length < 25) arr.push(c);
      callsByChannel.set(c.channelId, arr);
    }

    res.json({
      generatedAt: new Date().toISOString(),
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        phoneNumber: c.phoneNumber,
        type: c.type,
        isActive: c.isActive,
        isDefault: c.isDefault,
        flow: flowByChannel.get(c.id) ?? null,
        calls: (callsByChannel.get(c.id) ?? []).map(serializeSwitchboardCall),
      })),
      unassignedCalls: orphanCalls.map(serializeSwitchboardCall),
    });
  },
);

function serializeSwitchboardCall(
  c: typeof callRecordsTable.$inferSelect,
): Record<string, unknown> {
  return {
    id: c.id,
    status: c.status,
    priority: c.priority,
    callerPhone: c.callerPhone,
    calledNumber: c.calledNumber,
    customerName: c.customerName,
    intent: c.intent,
    summary: c.summary,
    durationSeconds: c.durationSeconds,
    provider: c.provider,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export default router;
