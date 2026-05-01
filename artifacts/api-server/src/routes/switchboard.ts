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
  liveCallSessionsTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

/**
 * GET /api/switchboard
 *
 * Phase 2 contract: `entries` array, one per channel, with last-24h
 * recentCalls. Phase 3 adds `liveSessions` — currently-active AI
 * receptionist conversations across the workspace. The shape is
 * additive so the existing dashboard keeps working untouched.
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

    const callsByChannel = new Map<string, typeof calls>();
    for (const c of calls) {
      const key = c.channelId ?? "__unassigned__";
      const arr = callsByChannel.get(key) ?? [];
      arr.push(c);
      callsByChannel.set(key, arr);
    }

    // Live AI receptionist sessions — anything not completed/failed is
    // worth showing on the operator switchboard. Bounded so a runaway
    // workflow can't balloon the payload.
    const liveRows = await db
      .select()
      .from(liveCallSessionsTable)
      .where(
        and(
          eq(liveCallSessionsTable.userId, userId),
          ne(liveCallSessionsTable.sessionStatus, "completed"),
          ne(liveCallSessionsTable.sessionStatus, "failed"),
        ),
      )
      .orderBy(desc(liveCallSessionsTable.startedAt))
      .limit(50);

    res.json({
      generatedAt: new Date().toISOString(),
      entries: channels.map((channel) => {
        const channelCalls = callsByChannel.get(channel.id) ?? [];
        return {
          channel: serializeChannel(channel),
          callsLast24h: channelCalls.length,
          recentCalls: channelCalls.slice(0, 25).map(serializeRecentCall),
        };
      }),
      liveSessions: liveRows.map((s) => ({
        id: s.id,
        channelId: s.channelId,
        callRecordId: s.callRecordId,
        receptionistProfileId: s.receptionistProfileId,
        provider: s.provider,
        callerPhone: s.callerPhone,
        calledNumber: s.calledNumber,
        sessionStatus: s.sessionStatus,
        currentStep: s.currentStep,
        lastQuestionKey: s.lastQuestionKey,
        collectedData: s.collectedData,
        intent: s.intent,
        priority: s.priority,
        sentiment: s.sentiment,
        transferTarget: s.transferTarget,
        escalationReason: s.escalationReason,
        // Trim live transcript so we never blow the response size on a
        // long call. The detail page can fetch the full one.
        transcriptLive: (s.transcriptLive ?? "").slice(-2000),
        aiSummaryLive: s.aiSummaryLive,
        notesCount: (s.notes ?? []).length,
        createdObjectIds: s.createdObjectIds,
        isDemo: s.isDemo === "true",
        startedAt: s.startedAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  },
);

function serializeChannel(c: typeof channelsTable.$inferSelect): Record<string, unknown> {
  return {
    id: c.id,
    userId: c.userId,
    name: c.name,
    phoneNumber: c.phoneNumber,
    type: c.type,
    defaultRoute: c.defaultRoute,
    isActive: c.isActive,
    isDefault: c.isDefault,
    greetingText: c.greetingText,
    recordCalls: c.recordCalls,
    allowVoicemail: c.allowVoicemail,
    businessHours: c.businessHours,
    afterHoursBehavior: c.afterHoursBehavior,
    forwardNumber: c.forwardNumber,
    maxCallDurationSeconds: c.maxCallDurationSeconds,
    recordingConsentText: c.recordingConsentText,
    assignedFlowId: c.assignedFlowId,
    productMode: c.productMode,
    liveBehavior: c.liveBehavior,
    receptionistProfileId: c.receptionistProfileId,
    requireRecordingConsent: c.requireRecordingConsent,
    consentScript: c.consentScript,
    consentRequiredBeforeRecording: c.consentRequiredBeforeRecording,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function serializeRecentCall(
  c: typeof callRecordsTable.$inferSelect,
): Record<string, unknown> {
  return {
    id: c.id,
    status: c.status,
    callerPhone: c.callerPhone,
    calledNumber: c.calledNumber,
    customerName: c.customerName,
    callType: c.callType,
    priority: c.priority,
    durationSeconds: c.durationSeconds,
    provider: c.provider,
    createdAt: c.createdAt.toISOString(),
  };
}

export default router;
