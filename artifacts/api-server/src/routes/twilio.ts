import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  callRecordsTable,
  channelsTable,
  liveCallSessionsTable,
  receptionistProfilesTable,
  telephonyEventsTable,
  transferLogsTable,
  transferTargetsTable,
  type Channel,
  type IntakeSchema,
  type LiveCallSession,
  type ReceptionistProfile,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  getTwilioConfig,
  getWebhookBaseUrl,
  isTwilioConfigured,
} from "../lib/twilio";
import { normalizeE164 } from "../lib/phoneNumbers";
import { twilioProvider } from "../services/telephony/twilioProvider";
import type { ChannelTwiMLContext } from "../services/telephony/types";
import { runCallPipeline } from "../services/callPipeline";
import { decideNextStep } from "../services/liveReceptionist";
import { createObjectForSession } from "../services/liveReceptionistObjects";
import { buildQuestionFor, evaluateIntake } from "../lib/intakeEngine";

const router: IRouter = Router();

const SAFE_HANGUP_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry, this number is not configured. Goodbye.</Say>
  <Hangup/>
</Response>`;

function sendTwiml(res: Response, body: string, status = 200): void {
  res.status(status).type("text/xml").send(body);
}

/**
 * Twilio webhooks don't carry our user_id. We route them by looking up
 * which workspace owns the dialed number (To). Cross-workspace lookup is
 * safe because:
 *   - signature validation rejects spoofed callbacks (default-on)
 *   - the lookup is by raw phone number, not a guessable id
 *   - we still scope every subsequent DB write to the resolved channel's
 *     userId so cross-tenant writes are impossible
 */
async function findChannelByDialedNumber(
  toNumber: string | null,
): Promise<Channel | null> {
  const wantedE164 = normalizeE164(toNumber);
  if (!wantedE164) return null;
  const rows = await db.select().from(channelsTable);
  return rows.find((c) => normalizeE164(c.phoneNumber) === wantedE164) ?? null;
}

async function logTelephonyEvent(args: {
  userId: string;
  callRecordId: string | null;
  eventType: string;
  providerEventId: string | null;
  rawPayload: Record<string, unknown>;
}): Promise<boolean> {
  try {
    await db.insert(telephonyEventsTable).values({
      userId: args.userId,
      callRecordId: args.callRecordId,
      provider: "twilio",
      eventType: args.eventType,
      providerEventId: args.providerEventId,
      rawPayload: args.rawPayload,
    });
    return true;
  } catch (err) {
    // Unique-constraint violation on (provider, providerEventId) just
    // means we got a retry — that's fine, swallow.
    logger.debug(
      { err, eventType: args.eventType },
      "telephony event insert skipped (likely dedupe)",
    );
    return false;
  }
}

function buildContext(channel: Channel | null): ChannelTwiMLContext {
  if (!channel) {
    return {
      greetingText: null,
      recordingConsentText: null,
      recordCalls: false,
      forwardNumber: null,
      maxCallDurationSeconds: null,
      channelMatched: false,
    };
  }
  return {
    greetingText:
      channel.greetingText ??
      "Thank you for calling. Please leave your message after the beep.",
    recordingConsentText: channel.recordCalls
      ? channel.recordingConsentText ??
        "This call may be recorded for quality and training purposes."
      : null,
    recordCalls: channel.recordCalls,
    forwardNumber: channel.forwardNumber,
    maxCallDurationSeconds: channel.maxCallDurationSeconds,
    channelMatched: true,
  };
}

function buildCallbackUrls(): {
  statusUrl: string;
  recordingUrl: string;
  transcriptionUrl: string;
  gatherUrl: string;
} {
  const base = getWebhookBaseUrl() ?? "";
  return {
    statusUrl: `${base}/api/twilio/voice/status`,
    recordingUrl: `${base}/api/twilio/voice/recording`,
    transcriptionUrl: `${base}/api/twilio/voice/transcription`,
    gatherUrl: `${base}/api/twilio/voice/gather`,
  };
}

async function loadProfileForChannel(
  channel: Channel,
): Promise<ReceptionistProfile | null> {
  // Prefer the explicitly-bound profile, then the workspace default.
  if (channel.receptionistProfileId) {
    const [bound] = await db
      .select()
      .from(receptionistProfilesTable)
      .where(
        and(
          eq(receptionistProfilesTable.id, channel.receptionistProfileId),
          eq(receptionistProfilesTable.userId, channel.userId),
          eq(receptionistProfilesTable.enabled, true),
        ),
      )
      .limit(1);
    if (bound) return bound;
  }
  const [def] = await db
    .select()
    .from(receptionistProfilesTable)
    .where(
      and(
        eq(receptionistProfilesTable.userId, channel.userId),
        eq(receptionistProfilesTable.isDefault, true),
        eq(receptionistProfilesTable.enabled, true),
      ),
    )
    .limit(1);
  return def ?? null;
}

async function ensureCallRecord(args: {
  channel: Channel;
  providerCallSid: string;
  fromNumber: string | null;
  toNumber: string | null;
}): Promise<string> {
  const [existing] = await db
    .select()
    .from(callRecordsTable)
    .where(
      and(
        eq(callRecordsTable.userId, args.channel.userId),
        eq(callRecordsTable.providerCallSid, args.providerCallSid),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(callRecordsTable)
    .values({
      userId: args.channel.userId,
      channelId: args.channel.id,
      originalFilename: `twilio-${args.providerCallSid}`,
      status: "incoming",
      provider: "twilio",
      providerCallSid: args.providerCallSid,
      callerPhone: args.fromNumber,
      calledNumber: args.toNumber,
      callDirection: "inbound",
      keyPoints: [],
      suggestedTags: [],
    })
    .returning();
  return created!.id;
}

async function ensureLiveSession(args: {
  channel: Channel;
  profile: ReceptionistProfile;
  providerCallSid: string;
  callRecordId: string;
  fromNumber: string | null;
  toNumber: string | null;
}): Promise<LiveCallSession> {
  const [existing] = await db
    .select()
    .from(liveCallSessionsTable)
    .where(eq(liveCallSessionsTable.providerCallSid, args.providerCallSid))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(liveCallSessionsTable)
    .values({
      userId: args.channel.userId,
      channelId: args.channel.id,
      callRecordId: args.callRecordId,
      receptionistProfileId: args.profile.id,
      provider: "twilio",
      providerCallSid: args.providerCallSid,
      callerPhone: args.fromNumber,
      calledNumber: args.toNumber,
      sessionStatus: "collecting_intake",
      currentStep: "greeting",
    })
    .returning();
  return created!;
}

function isAiBehavior(channel: Channel): boolean {
  return (
    channel.liveBehavior === "ai_receptionist" ||
    channel.liveBehavior === "ai_screen_then_transfer" ||
    channel.liveBehavior === "ai_after_hours_intake"
  );
}

// POST /api/twilio/voice/incoming
// Twilio dials this when a call lands on a configured number. We must
// respond with TwiML synchronously — anything heavy is deferred.
router.post(
  "/twilio/voice/incoming",
  async (req: Request, res: Response): Promise<void> => {
    if (!twilioProvider.validateRequest(req)) {
      sendTwiml(res, SAFE_HANGUP_TWIML, 403);
      return;
    }
    const parsed = twilioProvider.parseIncoming(req.body);
    if (!parsed) {
      sendTwiml(res, SAFE_HANGUP_TWIML, 400);
      return;
    }

    const channel = await findChannelByDialedNumber(parsed.toNumber);
    if (!channel || !channel.isActive) {
      logger.warn(
        { toNumber: parsed.toNumber, callSid: parsed.providerCallSid },
        "Twilio incoming: no matching/active channel for dialed number",
      );
      const ctx = buildContext(null);
      const out = twilioProvider.generateIncomingResponse(
        ctx,
        buildCallbackUrls(),
      );
      sendTwiml(res, out.body);
      return;
    }

    const callId = await ensureCallRecord({
      channel,
      providerCallSid: parsed.providerCallSid,
      fromNumber: parsed.fromNumber,
      toNumber: parsed.toNumber,
    });

    await logTelephonyEvent({
      userId: channel.userId,
      callRecordId: callId,
      eventType: "incoming",
      providerEventId: `incoming:${parsed.providerCallSid}`,
      rawPayload: parsed.rawPayload,
    });

    // Branch on the channel's live behavior. Non-AI behaviors keep the
    // Phase 2 record/forward/voicemail flow; AI behaviors enter the
    // multi-turn Gather loop.
    if (isAiBehavior(channel)) {
      const profile = await loadProfileForChannel(channel);
      if (!profile) {
        logger.warn(
          { channelId: channel.id },
          "AI live behavior set but no enabled receptionist profile — falling back to record",
        );
        const ctx = buildContext(channel);
        const out = twilioProvider.generateIncomingResponse(
          ctx,
          buildCallbackUrls(),
        );
        sendTwiml(res, out.body);
        return;
      }
      const session = await ensureLiveSession({
        channel,
        profile,
        providerCallSid: parsed.providerCallSid,
        callRecordId: callId,
        fromNumber: parsed.fromNumber,
        toNumber: parsed.toNumber,
      });
      const callbacks = buildCallbackUrls();

      // First-turn greeting + first intake question. The greeting comes
      // straight from the profile so the operator has full editorial
      // control over what the caller hears.
      const consentLine =
        channel.requireRecordingConsent && channel.consentScript
          ? channel.consentScript
          : null;
      const intakeState = evaluateIntake(
        profile.intakeSchema as IntakeSchema | null,
        session.collectedData ?? {},
      );
      const firstQuestion = intakeState.next
        ? buildQuestionFor(intakeState.next)
        : "How can we help you today?";
      const sayText = [profile.greetingScript, consentLine, firstQuestion]
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .join(" ");

      // Persist the field key we're asking for so /gather can bind the
      // answer correctly even if the caller's reply is ambiguous.
      await db
        .update(liveCallSessionsTable)
        .set({
          lastQuestionKey: intakeState.next?.key ?? null,
          askedFieldKeys: intakeState.next
            ? [...new Set([...(session.askedFieldKeys ?? []), intakeState.next.key])]
            : session.askedFieldKeys,
          currentStep: intakeState.next
            ? `asking ${intakeState.next.key}`
            : "open_question",
          transcriptLive: `${session.transcriptLive ?? ""}AI: ${sayText}\n`,
        })
        .where(eq(liveCallSessionsTable.id, session.id));

      const out = twilioProvider.buildGatherResponse({
        sayText,
        gatherActionUrl: callbacks.gatherUrl,
        timeoutHangupText:
          profile.fallbackScript ??
          "Thanks for calling. We'll follow up. Goodbye.",
      });
      sendTwiml(res, out.body);
      return;
    }

    // Non-AI behaviors: existing record / forward / voicemail flow.
    const ctx = buildContext(channel);
    const out = twilioProvider.generateIncomingResponse(
      ctx,
      buildCallbackUrls(),
    );
    sendTwiml(res, out.body);
  },
);

// POST /api/twilio/voice/gather — multi-turn AI receptionist loop.
// Idempotent: per-turn (provider_event_id keyed on CallSid + turn index).
router.post(
  "/twilio/voice/gather",
  async (req: Request, res: Response): Promise<void> => {
    if (!twilioProvider.validateRequest(req)) {
      sendTwiml(res, SAFE_HANGUP_TWIML, 403);
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const callSid = typeof body["CallSid"] === "string" ? body["CallSid"] : "";
    const speechResult =
      typeof body["SpeechResult"] === "string" ? body["SpeechResult"] : "";
    if (!callSid) {
      sendTwiml(res, SAFE_HANGUP_TWIML, 400);
      return;
    }

    const [session] = await db
      .select()
      .from(liveCallSessionsTable)
      .where(eq(liveCallSessionsTable.providerCallSid, callSid))
      .limit(1);
    if (!session) {
      // Unknown call — treat as a stray retry, hang up cleanly.
      logger.warn({ callSid }, "Gather for unknown live session");
      sendTwiml(
        res,
        twilioProvider.buildHangup({
          sayText: "We couldn't find your call. Please call back. Goodbye.",
        }).body,
      );
      return;
    }

    const callbacks = buildCallbackUrls();
    const turnIndex = (session.askedFieldKeys?.length ?? 0) + 1;
    const inserted = await logTelephonyEvent({
      userId: session.userId,
      callRecordId: session.callRecordId,
      eventType: "gather",
      // Per-turn key — Twilio won't re-process the same turn twice.
      providerEventId: `gather:${callSid}:${turnIndex}:${(speechResult || "").length}`,
      rawPayload: body,
    });
    // If the unique index rejected the insert, this is a duplicate retry
    // — return a benign continue-listening TwiML so we don't double-charge
    // the AI service for the same turn.
    if (!inserted) {
      sendTwiml(
        res,
        twilioProvider.buildGatherResponse({
          sayText: "Sorry, could you repeat that?",
          gatherActionUrl: callbacks.gatherUrl,
        }).body,
      );
      return;
    }

    const [profile] = session.receptionistProfileId
      ? await db
          .select()
          .from(receptionistProfilesTable)
          .where(eq(receptionistProfilesTable.id, session.receptionistProfileId))
          .limit(1)
      : [];

    if (!profile) {
      logger.warn(
        { sessionId: session.id },
        "Gather: receptionist profile missing — voicemail fallback",
      );
      await db
        .update(liveCallSessionsTable)
        .set({
          sessionStatus: "voicemail",
          currentStep: "voicemail",
        })
        .where(eq(liveCallSessionsTable.id, session.id));
      sendTwiml(
        res,
        twilioProvider.buildVoicemailRecord({
          sayText: "Please leave a message after the tone.",
          statusUrl: callbacks.statusUrl,
          recordingUrl: callbacks.recordingUrl,
        }).body,
      );
      return;
    }

    const channel = session.channelId
      ? (
          await db
            .select()
            .from(channelsTable)
            .where(eq(channelsTable.id, session.channelId))
            .limit(1)
        )[0] ?? null
      : null;

    // Append caller speech to the transcript before deciding so the AI
    // (and the fallback) see the full conversation.
    const newTranscript = `${session.transcriptLive ?? ""}Caller: ${speechResult || "(silence)"}\n`;

    const decision = await decideNextStep({
      profile,
      channel,
      collectedData: session.collectedData ?? {},
      lastQuestionKey: session.lastQuestionKey,
      transcript: newTranscript,
      latestSpeech: speechResult,
      callerPhone: session.callerPhone,
    });

    const mergedCollected = {
      ...(session.collectedData ?? {}),
      ...(decision.collectedDataUpdates ?? {}),
    };

    // Persist the AI's spoken response into the transcript so subsequent
    // turns and the operator switchboard see the full history.
    const transcriptWithAi = `${newTranscript}AI: ${decision.publicResponse}\n`;

    // Mirror coarse classification onto call_records so existing
    // dashboards (priority filters, sentiment charts) light up live.
    if (session.callRecordId) {
      await db
        .update(callRecordsTable)
        .set({
          intent: decision.intent || null,
          priority:
            decision.priority === "emergency"
              ? "urgent"
              : decision.priority === "high"
                ? "high"
                : decision.priority === "low"
                  ? "low"
                  : "medium",
          sentiment: decision.sentiment,
          status: "in_progress",
        })
        .where(eq(callRecordsTable.id, session.callRecordId));
    }

    // Determine the final response based on the action. We update the
    // session BEFORE writing TwiML so an operator polling the switchboard
    // sees the new state immediately.
    const baseUpdate = {
      collectedData: mergedCollected,
      transcriptLive: transcriptWithAi,
      aiSummaryLive: decision.reason || session.aiSummaryLive,
      intent: decision.intent || session.intent,
      priority: decision.priority,
      sentiment: decision.sentiment,
      currentStep: decision.recommendedAction,
    };

    let resolvedTransferTarget: { id: string; phoneNumber: string | null; name: string } | null = null;
    if (
      (decision.recommendedAction === "transfer" ||
        decision.recommendedAction === "escalate") &&
      decision.transferTarget
    ) {
      // Try to resolve as a transfer_targets row (by id or by name).
      const [byId] = decision.transferTarget.match(
        /^[0-9a-f-]{36}$/i,
      )
        ? await db
            .select()
            .from(transferTargetsTable)
            .where(
              and(
                eq(transferTargetsTable.id, decision.transferTarget),
                eq(transferTargetsTable.userId, session.userId),
              ),
            )
            .limit(1)
        : [];
      const target =
        byId ??
        (
          await db
            .select()
            .from(transferTargetsTable)
            .where(
              and(
                eq(transferTargetsTable.userId, session.userId),
                eq(transferTargetsTable.name, decision.transferTarget),
              ),
            )
            .limit(1)
        )[0] ??
        null;
      if (target && target.enabled && target.phoneNumber) {
        resolvedTransferTarget = {
          id: target.id,
          phoneNumber: target.phoneNumber,
          name: target.name,
        };
      }
    }

    switch (decision.recommendedAction) {
      case "transfer":
      case "escalate": {
        if (resolvedTransferTarget) {
          await db
            .update(liveCallSessionsTable)
            .set({
              ...baseUpdate,
              sessionStatus: "transferring",
              transferTarget: resolvedTransferTarget.name,
              escalationReason:
                decision.recommendedAction === "escalate"
                  ? decision.reason
                  : session.escalationReason,
            })
            .where(eq(liveCallSessionsTable.id, session.id));
          await db.insert(transferLogsTable).values({
            userId: session.userId,
            callRecordId: session.callRecordId,
            liveSessionId: session.id,
            targetId: resolvedTransferTarget.id,
            targetName: resolvedTransferTarget.name,
            status: "attempted",
            reason: decision.reason || decision.recommendedAction,
          });
          sendTwiml(
            res,
            twilioProvider.buildTransferDial({
              sayText: decision.publicResponse,
              phoneNumber: resolvedTransferTarget.phoneNumber!,
              statusUrl: callbacks.statusUrl,
              recordingUrl: callbacks.recordingUrl,
              recordCalls: channel?.recordCalls ?? true,
              maxCallDurationSeconds: channel?.maxCallDurationSeconds ?? null,
            }).body,
          );
          return;
        }
        // No usable transfer target — fall through to voicemail so the
        // caller is never dropped silently.
        await db
          .update(liveCallSessionsTable)
          .set({
            ...baseUpdate,
            sessionStatus: "voicemail",
            escalationReason:
              decision.reason ||
              "Transfer requested but no usable target — voicemail fallback",
          })
          .where(eq(liveCallSessionsTable.id, session.id));
        sendTwiml(
          res,
          twilioProvider.buildVoicemailRecord({
            sayText:
              "I'm unable to connect you directly right now. Please leave a message after the tone.",
            statusUrl: callbacks.statusUrl,
            recordingUrl: callbacks.recordingUrl,
          }).body,
        );
        return;
      }

      case "voicemail": {
        await db
          .update(liveCallSessionsTable)
          .set({
            ...baseUpdate,
            sessionStatus: "voicemail",
          })
          .where(eq(liveCallSessionsTable.id, session.id));
        sendTwiml(
          res,
          twilioProvider.buildVoicemailRecord({
            sayText:
              decision.publicResponse ||
              profile.voicemailScript ||
              "Please leave a message after the tone.",
            statusUrl: callbacks.statusUrl,
            recordingUrl: callbacks.recordingUrl,
          }).body,
        );
        return;
      }

      case "create_ticket":
      case "create_lead":
      case "create_task": {
        // Persist updates first so createObjectForSession sees the latest
        // collectedData / priority etc.
        const updatedSession = (
          await db
            .update(liveCallSessionsTable)
            .set({
              ...baseUpdate,
              sessionStatus: "completed",
              endedAt: new Date(),
            })
            .where(eq(liveCallSessionsTable.id, session.id))
            .returning()
        )[0]!;
        await createObjectForSession({
          session: updatedSession,
          decision,
        });
        sendTwiml(
          res,
          twilioProvider.buildHangup({
            sayText:
              decision.publicResponse ||
              "Thank you. We'll follow up shortly. Goodbye.",
          }).body,
        );
        return;
      }

      case "end_call": {
        await db
          .update(liveCallSessionsTable)
          .set({
            ...baseUpdate,
            sessionStatus: "completed",
            endedAt: new Date(),
          })
          .where(eq(liveCallSessionsTable.id, session.id));
        sendTwiml(
          res,
          twilioProvider.buildHangup({
            sayText: decision.publicResponse || "Thank you. Goodbye.",
          }).body,
        );
        return;
      }

      case "ask_next":
      default: {
        // Re-evaluate against merged data so we ask for the next missing
        // field even if the AI didn't explicitly name one.
        const state = evaluateIntake(
          profile.intakeSchema as IntakeSchema | null,
          mergedCollected,
        );
        const nextKey = decision.nextQuestion ?? state.next?.key ?? null;
        await db
          .update(liveCallSessionsTable)
          .set({
            ...baseUpdate,
            lastQuestionKey: nextKey,
            askedFieldKeys: nextKey
              ? [...new Set([...(session.askedFieldKeys ?? []), nextKey])]
              : session.askedFieldKeys,
            sessionStatus: "collecting_intake",
          })
          .where(eq(liveCallSessionsTable.id, session.id));
        sendTwiml(
          res,
          twilioProvider.buildGatherResponse({
            sayText:
              decision.publicResponse ||
              (state.next ? buildQuestionFor(state.next) : "How can we help?"),
            gatherActionUrl: callbacks.gatherUrl,
            timeoutHangupText:
              profile.fallbackScript ??
              "Thanks for calling. We'll follow up. Goodbye.",
          }).body,
        );
        return;
      }
    }
  },
);

// POST /api/twilio/voice/status — call lifecycle updates.
router.post(
  "/twilio/voice/status",
  async (req: Request, res: Response): Promise<void> => {
    if (!twilioProvider.validateRequest(req)) {
      res.status(403).end();
      return;
    }
    const parsed = twilioProvider.parseStatus(req.body);
    if (!parsed) {
      res.status(204).end();
      return;
    }
    const [call] = await db
      .select()
      .from(callRecordsTable)
      .where(eq(callRecordsTable.providerCallSid, parsed.providerCallSid))
      .limit(1);
    if (!call) {
      logger.debug(
        { callSid: parsed.providerCallSid, status: parsed.callStatus },
        "Twilio status for unknown CallSid",
      );
      res.status(204).end();
      return;
    }
    await db
      .update(callRecordsTable)
      .set({
        status: parsed.callStatus,
        ...(parsed.durationSeconds != null
          ? { durationSeconds: parsed.durationSeconds }
          : {}),
      })
      .where(eq(callRecordsTable.id, call.id));
    // Mirror terminal statuses onto the live session so the switchboard
    // stops showing the call as active once Twilio confirms it ended.
    if (
      parsed.callStatus === "completed" ||
      parsed.callStatus === "failed" ||
      parsed.callStatus === "busy" ||
      parsed.callStatus === "no_answer"
    ) {
      await db
        .update(liveCallSessionsTable)
        .set({
          sessionStatus:
            parsed.callStatus === "completed" ? "completed" : "failed",
          endedAt: new Date(),
        })
        .where(
          and(
            eq(liveCallSessionsTable.providerCallSid, parsed.providerCallSid),
            eq(liveCallSessionsTable.userId, call.userId),
          ),
        );
    }
    await logTelephonyEvent({
      userId: call.userId,
      callRecordId: call.id,
      eventType: `status:${parsed.callStatus}`,
      providerEventId: `status:${parsed.providerCallSid}:${parsed.callStatus}`,
      rawPayload: parsed.rawPayload,
    });
    res.status(204).end();
  },
);

// POST /api/twilio/voice/recording — recording is ready, attach it and
// kick the analysis pipeline. For live sessions in `voicemail` state we
// also flip the session to `completed` once the recording arrives.
router.post(
  "/twilio/voice/recording",
  async (req: Request, res: Response): Promise<void> => {
    if (!twilioProvider.validateRequest(req)) {
      res.status(403).end();
      return;
    }
    const parsed = twilioProvider.parseRecording(req.body);
    if (!parsed) {
      res.status(204).end();
      return;
    }

    const [call] = await db
      .select()
      .from(callRecordsTable)
      .where(eq(callRecordsTable.providerCallSid, parsed.providerCallSid))
      .limit(1);
    if (!call) {
      logger.warn(
        { callSid: parsed.providerCallSid, recordingSid: parsed.recordingSid },
        "Recording callback for unknown CallSid",
      );
      res.status(204).end();
      return;
    }

    if (call.recordingSid === parsed.recordingSid) {
      await logTelephonyEvent({
        userId: call.userId,
        callRecordId: call.id,
        eventType: "recording:duplicate",
        providerEventId: `recording:${parsed.recordingSid}`,
        rawPayload: parsed.rawPayload,
      });
      res.status(204).end();
      return;
    }

    try {
      await db
        .update(callRecordsTable)
        .set({
          recordingUrl: parsed.recordingUrl,
          recordingSid: parsed.recordingSid,
          recordingDurationSeconds: parsed.recordingDurationSeconds,
          status: "recording_ready",
        })
        .where(eq(callRecordsTable.id, call.id));
    } catch (err) {
      logger.warn({ err, recordingSid: parsed.recordingSid }, "Recording attach raced");
      res.status(204).end();
      return;
    }

    await db
      .update(liveCallSessionsTable)
      .set({
        sessionStatus: "completed",
        endedAt: new Date(),
      })
      .where(
        and(
          eq(liveCallSessionsTable.providerCallSid, parsed.providerCallSid),
          eq(liveCallSessionsTable.userId, call.userId),
        ),
      );

    await logTelephonyEvent({
      userId: call.userId,
      callRecordId: call.id,
      eventType: "recording:ready",
      providerEventId: `recording:${parsed.recordingSid}`,
      rawPayload: parsed.rawPayload,
    });

    res.status(204).end();

    // Best-effort fire-and-forget analysis.
    void (async () => {
      try {
        const audioBuffer = await twilioProvider.downloadRecording(
          parsed.recordingUrl,
        );
        await runCallPipeline({
          userId: call.userId,
          callId: call.id,
          source: { audioBuffer },
          originalFilename: `twilio-${parsed.recordingSid}.wav`,
        });
      } catch (err) {
        logger.error({ err, callId: call.id }, "Twilio pipeline failed");
        await db
          .update(callRecordsTable)
          .set({
            status: "error",
            errorMessage:
              err instanceof Error ? err.message : "Pipeline failed",
          })
          .where(eq(callRecordsTable.id, call.id));
      }
    })();
  },
);

// POST /api/twilio/voice/transcription — optional. Logs the event;
// transcript is only persisted if we don't already have one.
router.post(
  "/twilio/voice/transcription",
  async (req: Request, res: Response): Promise<void> => {
    if (!twilioProvider.validateRequest(req)) {
      res.status(403).end();
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const callSid = typeof body["CallSid"] === "string" ? body["CallSid"] : null;
    const text =
      typeof body["TranscriptionText"] === "string"
        ? body["TranscriptionText"]
        : null;
    if (!callSid) {
      res.status(204).end();
      return;
    }
    const [call] = await db
      .select()
      .from(callRecordsTable)
      .where(eq(callRecordsTable.providerCallSid, callSid))
      .limit(1);
    if (!call) {
      res.status(204).end();
      return;
    }
    if (text && !call.transcriptText) {
      await db
        .update(callRecordsTable)
        .set({ transcriptText: text })
        .where(eq(callRecordsTable.id, call.id));
    }
    await logTelephonyEvent({
      userId: call.userId,
      callRecordId: call.id,
      eventType: "transcription",
      providerEventId: `transcription:${callSid}`,
      rawPayload: body,
    });
    res.status(204).end();
  },
);

// GET /api/telephony/twilio/status — admin view (auth-required).
import { requireAuth } from "../middlewares/requireAuth";

router.get(
  "/telephony/twilio/status",
  requireAuth,
  async (_req: Request, res: Response): Promise<void> => {
    const cfg = getTwilioConfig();
    const base = getWebhookBaseUrl();
    res.json({
      configured: isTwilioConfigured(cfg),
      hasAccountSid: Boolean(cfg.accountSid),
      hasAuthToken: Boolean(cfg.authToken),
      hasApiKey: Boolean(cfg.apiKey),
      hasApiSecret: Boolean(cfg.apiSecret),
      validateSignature: cfg.validateSignature,
      defaultRecordCalls: cfg.defaultRecordCalls,
      webhookBaseUrl: base,
      webhooks: base
        ? {
            incoming: `${base}/api/twilio/voice/incoming`,
            gather: `${base}/api/twilio/voice/gather`,
            status: `${base}/api/twilio/voice/status`,
            recording: `${base}/api/twilio/voice/recording`,
            transcription: `${base}/api/twilio/voice/transcription`,
          }
        : null,
    });
  },
);

// GET /api/telephony/events?callId=<uuid>
router.get(
  "/telephony/events",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const callId =
      typeof req.query["callId"] === "string" ? req.query["callId"] : null;
    if (!callId) {
      res.status(400).json({ error: "callId is required" });
      return;
    }
    const [call] = await db
      .select({ id: callRecordsTable.id })
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.id, callId),
          eq(callRecordsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!call) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    const rows = await db
      .select()
      .from(telephonyEventsTable)
      .where(
        and(
          eq(telephonyEventsTable.callRecordId, callId),
          eq(telephonyEventsTable.userId, userId),
        ),
      );
    res.json(
      rows
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((r) => ({
          id: r.id,
          provider: r.provider,
          eventType: r.eventType,
          providerEventId: r.providerEventId,
          rawPayload: r.rawPayload,
          createdAt: r.createdAt.toISOString(),
        })),
    );
  },
);

export default router;
