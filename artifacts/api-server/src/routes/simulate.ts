import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  callRecordsTable,
  liveCallSessionsTable,
  receptionistProfilesTable,
  type CallRecord,
  type LiveCallSession,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  executeFlowForCall,
  resolveActiveFlowFor,
} from "../services/flowEngine";
import {
  ensureDefaultRules,
  evaluateAndExecuteRules,
} from "../services/rulesEngine";
import { resolveChannelForIngestion } from "./channels";
import { logger } from "../lib/logger";
import { decideNextStep } from "../services/liveReceptionist";
import { createObjectForSession } from "../services/liveReceptionistObjects";

const router: IRouter = Router();

/**
 * Synchronous simulation: caller picks a channel + provides a transcript and
 * optional intent/priority/sentiment. We create a `call_records` row marked
 * `isDemo=true`, run the rules engine, then walk the channel-bound flow.
 * The full flow trace is returned in the response so the UI can render it
 * step-by-step without polling.
 */
router.post(
  "/simulate-call",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const transcript =
      typeof body.transcript === "string" && body.transcript.trim()
        ? body.transcript
        : "Simulated inbound call. The caller is interested in scheduling a demo next week.";
    const customerName =
      typeof body.customerName === "string" && body.customerName.trim()
        ? body.customerName
        : null;
    const callerPhone =
      typeof body.callerPhone === "string" && body.callerPhone.trim()
        ? body.callerPhone
        : null;
    // The UI passes channelId explicitly; if the caller instead sends a
    // line number we route on that, NOT on the caller phone (channels are
    // keyed off the inbound line, not who's calling in).
    const lineNumber =
      typeof body.lineNumber === "string" && body.lineNumber.trim()
        ? body.lineNumber
        : typeof body.toNumber === "string" && body.toNumber.trim()
          ? body.toNumber
          : null;
    const requestedChannelId =
      typeof body.channelId === "string" ? body.channelId : null;

    const channel = await resolveChannelForIngestion({
      userId,
      phoneNumber: lineNumber,
      preferredChannelId: requestedChannelId,
    });

    // Derive a quick keyword-based analysis so the call has fields for
    // condition nodes to act on. Caller can override.
    const lowered = transcript.toLowerCase();
    const intent =
      typeof body.intent === "string"
        ? body.intent
        : lowered.match(/cancel|refund|broken|crash|bug|error/) ? "support"
        : lowered.match(/buy|price|demo|trial|interested|quote/) ? "sales"
        : lowered.match(/schedule|appointment|book|reschedule/) ? "scheduling"
        : "general";
    const priority =
      typeof body.priority === "string"
        ? body.priority
        : lowered.match(/urgent|asap|immediately|critical/) ? "urgent"
        : lowered.match(/important|priority|today/) ? "high"
        : "medium";
    const sentiment =
      typeof body.sentiment === "string"
        ? body.sentiment
        : lowered.match(/angry|frustrated|disappointed|terrible/)
          ? "negative"
          : lowered.match(/happy|love|great|amazing|thanks/)
            ? "positive"
            : "neutral";

    const callType = intent;
    const summary = transcript.slice(0, 280);

    const [created] = await db
      .insert(callRecordsTable)
      .values({
        userId,
        originalFilename: `simulated-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
        transcriptText: transcript,
        summary,
        customerName,
        callerPhone,
        callType,
        intent,
        priority,
        sentiment,
        status: "ready",
        keyPoints: [transcript.slice(0, 120)],
        suggestedTags: [intent],
        isDemo: "true",
        channelId: channel.id,
      })
      .returning();
    const call: CallRecord = created!;

    // Run rules first (independent surface), then the channel's flow.
    try {
      await ensureDefaultRules(userId);
      await evaluateAndExecuteRules({ userId, call });
    } catch (err) {
      logger.warn({ err }, "Rule evaluation during simulation failed");
    }

    let flowResult: Awaited<ReturnType<typeof executeFlowForCall>> | null =
      null;
    const flow = await resolveActiveFlowFor(userId, channel.id);
    if (flow) {
      try {
        flowResult = await executeFlowForCall({ userId, call, flow });
      } catch (err) {
        logger.warn({ err }, "Flow execution during simulation failed");
      }
    }

    // Re-read the call so the response reflects any in-flow mutations.
    const [refreshed] = await db
      .select()
      .from(callRecordsTable)
      .where(eq(callRecordsTable.id, call.id))
      .limit(1);

    res.status(201).json({
      callId: refreshed?.id ?? call.id,
      flowId: flowResult?.flowId ?? null,
      flowName: flowResult?.flowName ?? null,
      nodesExecuted: flowResult?.nodesExecuted ?? 0,
      actionsExecuted: flowResult?.actionsExecuted ?? 0,
      endedAt: flowResult?.endedAt ?? null,
      log: (flowResult?.log ?? []).map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  },
);

/**
 * Live-call simulator. Lets the operator drive a fake AI receptionist
 * conversation turn-by-turn from the UI without ever touching Twilio.
 *
 * - Every session is flagged `isDemo=true`. The switchboard hides demo
 *   sessions from production summaries. Pipelines that touch real
 *   inboxes (webhooks, slack) refuse to fire on demo records.
 * - Re-uses `decideNextStep` and `createObjectForSession` so the demo
 *   path is identical to the live Gather path — bug-for-bug parity is
 *   the whole point of having a simulator.
 */

function serializeLiveSession(s: LiveCallSession): Record<string, unknown> {
  return {
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
    askedFieldKeys: s.askedFieldKeys,
    collectedData: s.collectedData,
    intent: s.intent,
    priority: s.priority,
    sentiment: s.sentiment,
    transferTarget: s.transferTarget,
    escalationReason: s.escalationReason,
    transcriptLive: s.transcriptLive,
    aiSummaryLive: s.aiSummaryLive,
    notes: s.notes,
    createdObjectIds: s.createdObjectIds,
    isDemo: s.isDemo === "true",
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

router.post(
  "/simulate/live-call/start",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const callerPhone =
      typeof body["callerPhone"] === "string" ? body["callerPhone"] : null;
    const calledNumber =
      typeof body["calledNumber"] === "string" ? body["calledNumber"] : null;
    const requestedProfileId =
      typeof body["receptionistProfileId"] === "string"
        ? body["receptionistProfileId"]
        : null;

    // Pick a profile: explicit > workspace default > first enabled.
    let profile = null;
    if (requestedProfileId) {
      const [p] = await db
        .select()
        .from(receptionistProfilesTable)
        .where(
          and(
            eq(receptionistProfilesTable.id, requestedProfileId),
            eq(receptionistProfilesTable.userId, userId),
          ),
        )
        .limit(1);
      profile = p ?? null;
    }
    if (!profile) {
      const [p] = await db
        .select()
        .from(receptionistProfilesTable)
        .where(
          and(
            eq(receptionistProfilesTable.userId, userId),
            eq(receptionistProfilesTable.isDefault, true),
            eq(receptionistProfilesTable.enabled, true),
          ),
        )
        .limit(1);
      profile = p ?? null;
    }
    if (!profile) {
      const [p] = await db
        .select()
        .from(receptionistProfilesTable)
        .where(
          and(
            eq(receptionistProfilesTable.userId, userId),
            eq(receptionistProfilesTable.enabled, true),
          ),
        )
        .limit(1);
      profile = p ?? null;
    }
    if (!profile) {
      res
        .status(400)
        .json({
          error:
            "No enabled receptionist profile. Create one (or apply a product mode) before simulating.",
        });
      return;
    }

    const channel = await resolveChannelForIngestion({
      userId,
      phoneNumber: calledNumber,
      preferredChannelId: null,
    });

    // Companion call_record so the session can hang ticket/lead/task off
    // a real link. Marked isDemo so dashboards filter it out.
    const [call] = await db
      .insert(callRecordsTable)
      .values({
        userId,
        channelId: channel.id,
        originalFilename: `live-sim-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
        status: "incoming",
        callerPhone,
        calledNumber,
        callDirection: "inbound",
        provider: "twilio",
        keyPoints: [],
        suggestedTags: [],
        isDemo: "true",
      })
      .returning();

    const [session] = await db
      .insert(liveCallSessionsTable)
      .values({
        userId,
        channelId: channel.id,
        callRecordId: call!.id,
        receptionistProfileId: profile.id,
        provider: "twilio",
        callerPhone,
        calledNumber,
        sessionStatus: "collecting_intake",
        currentStep: "greeting",
        transcriptLive: `AI: ${profile.greetingScript}\n`,
        isDemo: "true",
      })
      .returning();

    res.status(201).json({
      session: serializeLiveSession(session!),
      profile: {
        id: profile.id,
        name: profile.name,
        greetingScript: profile.greetingScript,
        intakeSchema: profile.intakeSchema,
      },
    });
  },
);

router.post(
  "/simulate/live-call/:id/say",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const speech = typeof body["text"] === "string" ? body["text"].trim() : "";
    if (!speech) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    const [session] = await db
      .select()
      .from(liveCallSessionsTable)
      .where(
        and(
          eq(liveCallSessionsTable.id, id),
          eq(liveCallSessionsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!session) {
      res.status(404).json({ error: "Live session not found" });
      return;
    }
    if (
      session.sessionStatus === "completed" ||
      session.sessionStatus === "failed"
    ) {
      res.status(409).json({ error: "Session already ended" });
      return;
    }

    const [profile] = session.receptionistProfileId
      ? await db
          .select()
          .from(receptionistProfilesTable)
          .where(
            eq(receptionistProfilesTable.id, session.receptionistProfileId),
          )
          .limit(1)
      : [];
    if (!profile) {
      res.status(409).json({ error: "Receptionist profile missing" });
      return;
    }

    const transcriptWithCaller = `${session.transcriptLive ?? ""}Caller: ${speech}\n`;
    const decision = await decideNextStep({
      profile,
      channel: null,
      collectedData: session.collectedData ?? {},
      lastQuestionKey: session.lastQuestionKey,
      transcript: transcriptWithCaller,
      latestSpeech: speech,
      callerPhone: session.callerPhone,
    });

    const mergedCollected = {
      ...(session.collectedData ?? {}),
      ...(decision.collectedDataUpdates ?? {}),
    };
    const transcriptWithAi = `${transcriptWithCaller}AI: ${decision.publicResponse}\n`;
    const isTerminal =
      decision.recommendedAction === "end_call" ||
      decision.recommendedAction === "create_ticket" ||
      decision.recommendedAction === "create_lead" ||
      decision.recommendedAction === "create_task" ||
      decision.recommendedAction === "voicemail";

    const [updated] = await db
      .update(liveCallSessionsTable)
      .set({
        collectedData: mergedCollected,
        transcriptLive: transcriptWithAi,
        aiSummaryLive: decision.reason || session.aiSummaryLive,
        intent: decision.intent || session.intent,
        priority: decision.priority,
        sentiment: decision.sentiment,
        currentStep: decision.recommendedAction,
        lastQuestionKey:
          decision.recommendedAction === "ask_next"
            ? decision.nextQuestion ?? session.lastQuestionKey
            : null,
        sessionStatus: isTerminal
          ? decision.recommendedAction === "voicemail"
            ? "voicemail"
            : "completed"
          : "collecting_intake",
        endedAt: isTerminal ? new Date() : null,
      })
      .where(eq(liveCallSessionsTable.id, session.id))
      .returning();

    let createdObject: { kind: string; id: string } | null = null;
    if (
      decision.recommendedAction === "create_ticket" ||
      decision.recommendedAction === "create_lead" ||
      decision.recommendedAction === "create_task"
    ) {
      createdObject = await createObjectForSession({
        session: updated!,
        decision,
      });
    }

    res.json({
      session: serializeLiveSession(updated!),
      decision: {
        intent: decision.intent,
        priority: decision.priority,
        sentiment: decision.sentiment,
        recommendedAction: decision.recommendedAction,
        reason: decision.reason,
        publicResponse: decision.publicResponse,
        internalNote: decision.internalNote,
        transferTarget: decision.transferTarget,
        nextQuestion: decision.nextQuestion,
      },
      createdObject,
    });
  },
);

router.post(
  "/simulate/live-call/:id/end",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const [session] = await db
      .select()
      .from(liveCallSessionsTable)
      .where(
        and(
          eq(liveCallSessionsTable.id, id),
          eq(liveCallSessionsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!session) {
      res.status(404).json({ error: "Live session not found" });
      return;
    }
    const [updated] = await db
      .update(liveCallSessionsTable)
      .set({
        sessionStatus: "completed",
        endedAt: new Date(),
        currentStep: "ended",
      })
      .where(eq(liveCallSessionsTable.id, session.id))
      .returning();
    res.json({ session: serializeLiveSession(updated!) });
  },
);

export default router;
