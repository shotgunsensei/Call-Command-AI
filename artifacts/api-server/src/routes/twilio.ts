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
  telephonyEventsTable,
  type Channel,
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
  // Pull any rows that even loosely match. We then re-normalize in JS so
  // legacy rows with different formatting still resolve. For modest
  // workspace counts this is fine; if it ever becomes a hot path we can
  // add a generated normalized column.
  const rows = await db.select().from(channelsTable);
  return rows.find((c) => normalizeE164(c.phoneNumber) === wantedE164) ?? null;
}

async function logTelephonyEvent(args: {
  userId: string;
  callRecordId: string | null;
  eventType: string;
  providerEventId: string | null;
  rawPayload: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(telephonyEventsTable).values({
      userId: args.userId,
      callRecordId: args.callRecordId,
      provider: "twilio",
      eventType: args.eventType,
      providerEventId: args.providerEventId,
      rawPayload: args.rawPayload,
    });
  } catch (err) {
    // Unique-constraint violation on (provider, providerEventId) just
    // means we got a retry — that's fine, swallow.
    logger.debug({ err, eventType: args.eventType }, "telephony event insert skipped (likely dedupe)");
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
} {
  const base = getWebhookBaseUrl() ?? "";
  return {
    statusUrl: `${base}/api/twilio/voice/status`,
    recordingUrl: `${base}/api/twilio/voice/recording`,
    transcriptionUrl: `${base}/api/twilio/voice/transcription`,
  };
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
    if (!channel) {
      // No workspace owns this number. Hang up safely; we can't even log
      // the event without a userId.
      logger.warn(
        { toNumber: parsed.toNumber, callSid: parsed.providerCallSid },
        "Twilio incoming: no matching channel for dialed number",
      );
      const ctx = buildContext(null);
      const out = twilioProvider.generateIncomingResponse(
        ctx,
        buildCallbackUrls(),
      );
      sendTwiml(res, out.body);
      return;
    }

    if (!channel.isActive) {
      const ctx = buildContext(null);
      const out = twilioProvider.generateIncomingResponse(
        ctx,
        buildCallbackUrls(),
      );
      sendTwiml(res, out.body);
      return;
    }

    // Idempotency: if Twilio retries the incoming hook with the same
    // CallSid, return the same TwiML and don't double-insert.
    const [existing] = await db
      .select()
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.userId, channel.userId),
          eq(callRecordsTable.providerCallSid, parsed.providerCallSid),
        ),
      )
      .limit(1);

    let callId: string;
    if (existing) {
      callId = existing.id;
    } else {
      const [created] = await db
        .insert(callRecordsTable)
        .values({
          userId: channel.userId,
          channelId: channel.id,
          originalFilename: `twilio-${parsed.providerCallSid}`,
          status: "incoming",
          provider: "twilio",
          providerCallSid: parsed.providerCallSid,
          callerPhone: parsed.fromNumber,
          calledNumber: parsed.toNumber,
          callDirection: "inbound",
          keyPoints: [],
          suggestedTags: [],
        })
        .returning();
      callId = created!.id;
    }

    await logTelephonyEvent({
      userId: channel.userId,
      callRecordId: callId,
      eventType: "incoming",
      providerEventId: `incoming:${parsed.providerCallSid}`,
      rawPayload: parsed.rawPayload,
    });

    const ctx = buildContext(channel);
    const out = twilioProvider.generateIncomingResponse(
      ctx,
      buildCallbackUrls(),
    );
    sendTwiml(res, out.body);
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
      // Status callback arrived before we created the call record — common
      // when the incoming hook is still mid-flight. Just log and exit.
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
// kick the analysis pipeline.
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

    // Idempotency: Twilio retries on 5xx and on its own schedule. If we
    // already have THIS recordingSid attached to THIS call, no-op.
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
      // recording_sid has a UNIQUE index — if another callback already
      // attached it (cross-call edge case), surface as duplicate.
      logger.warn({ err, recordingSid: parsed.recordingSid }, "Recording attach raced");
      res.status(204).end();
      return;
    }

    await logTelephonyEvent({
      userId: call.userId,
      callRecordId: call.id,
      eventType: "recording:ready",
      providerEventId: `recording:${parsed.recordingSid}`,
      rawPayload: parsed.rawPayload,
    });

    // ACK Twilio immediately so it doesn't time out, then run the pipeline
    // in the background. Pipeline failures get persisted as call.status =
    // error; they don't bubble back to Twilio.
    res.status(204).end();

    // Best-effort fire-and-forget. We deliberately don't await on the
    // request thread.
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
// transcript is only persisted if we don't already have one (we prefer
// our own pipeline's output).
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
            status: `${base}/api/twilio/voice/status`,
            recording: `${base}/api/twilio/voice/recording`,
            transcription: `${base}/api/twilio/voice/transcription`,
          }
        : null,
    });
  },
);

// GET /api/telephony/events?callId=<uuid> — view raw provider events
// linked to a specific call (auth-required, scoped to caller's user).
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
    // Confirm the call belongs to this user before exposing events.
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
