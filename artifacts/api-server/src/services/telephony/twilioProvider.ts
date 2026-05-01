import type { Request } from "express";
import type { CallRecordStatus } from "@workspace/db";
import {
  flattenForm,
  getTwilioConfig,
  rebuildPublicUrl,
  validateTwilioSignature,
} from "../../lib/twilio";
import { logger } from "../../lib/logger";
import type {
  ChannelTwiMLContext,
  NormalizedIncoming,
  NormalizedRecording,
  NormalizedStatus,
  TelephonyProvider,
} from "./types";

function readStr(
  body: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!body) return null;
  const v = body[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

const STATUS_MAP: Record<string, CallRecordStatus> = {
  queued: "incoming",
  initiated: "incoming",
  ringing: "ringing",
  "in-progress": "in_progress",
  completed: "completed",
  busy: "busy",
  failed: "failed",
  "no-answer": "no_answer",
  canceled: "failed",
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const twilioProvider: TelephonyProvider = {
  id: "twilio",

  validateRequest(req: Request): boolean {
    const cfg = getTwilioConfig();
    // When validation is intentionally disabled (local dev / tests) we
    // accept the request but log a debug breadcrumb so it's discoverable.
    if (!cfg.validateSignature) {
      req.log?.debug?.(
        { route: req.originalUrl },
        "TWILIO_VALIDATE_SIGNATURE disabled; skipping signature check",
      );
      return true;
    }
    if (!cfg.authToken) {
      req.log?.warn?.(
        "Twilio auth token missing; cannot validate signature — rejecting",
      );
      return false;
    }
    const signature = req.header("X-Twilio-Signature") ?? "";
    const publicUrl = rebuildPublicUrl(req);
    if (!publicUrl) {
      req.log?.warn?.(
        "Cannot rebuild public URL for signature validation (no TWILIO_WEBHOOK_BASE_URL or REPLIT_DOMAINS)",
      );
      return false;
    }
    const params = flattenForm(req.body);
    const ok = validateTwilioSignature({
      authToken: cfg.authToken,
      signature,
      publicUrl,
      params,
    });
    if (!ok) {
      req.log?.warn?.({ url: publicUrl }, "Twilio signature validation failed");
    }
    return ok;
  },

  parseIncoming(body: unknown): NormalizedIncoming | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    const callSid = readStr(b, "CallSid");
    if (!callSid) return null;
    return {
      providerCallSid: callSid,
      fromNumber: readStr(b, "From") ?? readStr(b, "Caller"),
      toNumber: readStr(b, "To") ?? readStr(b, "Called"),
      rawPayload: b,
    };
  },

  parseStatus(body: unknown): NormalizedStatus | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    const callSid = readStr(b, "CallSid");
    if (!callSid) return null;
    const raw = readStr(b, "CallStatus") ?? "";
    const mapped = STATUS_MAP[raw.toLowerCase()] ?? "in_progress";
    const dur = readStr(b, "CallDuration");
    return {
      providerCallSid: callSid,
      callStatus: mapped,
      durationSeconds: dur && /^\d+$/.test(dur) ? parseInt(dur, 10) : null,
      rawPayload: b,
    };
  },

  parseRecording(body: unknown): NormalizedRecording | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    const callSid = readStr(b, "CallSid");
    const recordingSid = readStr(b, "RecordingSid");
    const recordingUrl = readStr(b, "RecordingUrl");
    if (!callSid || !recordingSid || !recordingUrl) return null;
    const dur = readStr(b, "RecordingDuration");
    return {
      providerCallSid: callSid,
      recordingSid,
      recordingUrl,
      recordingDurationSeconds:
        dur && /^\d+$/.test(dur) ? parseInt(dur, 10) : null,
      rawPayload: b,
    };
  },

  generateIncomingResponse(
    ctx: ChannelTwiMLContext,
    callbacks: {
      statusUrl: string;
      recordingUrl: string;
      transcriptionUrl: string;
    },
  ): { contentType: string; body: string } {
    const lines: string[] = [];
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(`<Response>`);

    // No matching channel and no default: keep it short and safe so the
    // caller hears a real-sounding message instead of a Twilio error tone.
    if (!ctx.channelMatched) {
      lines.push(
        `  <Say voice="Polly.Joanna">Thank you for calling. This number is not currently configured. Goodbye.</Say>`,
      );
      lines.push(`  <Hangup/>`);
      lines.push(`</Response>`);
      return { contentType: "text/xml", body: lines.join("\n") };
    }

    if (ctx.greetingText) {
      lines.push(
        `  <Say voice="Polly.Joanna">${escapeXml(ctx.greetingText)}</Say>`,
      );
    }
    if (ctx.recordingConsentText && ctx.recordCalls) {
      lines.push(
        `  <Say voice="Polly.Joanna">${escapeXml(ctx.recordingConsentText)}</Say>`,
      );
    }

    if (ctx.forwardNumber) {
      // Bridge to the configured PSTN number. Recording the bridged leg is
      // configurable via Dial.record. Status callback gives us hangup info.
      const dialAttrs = [
        `action="${callbacks.statusUrl}"`,
        `method="POST"`,
        ctx.maxCallDurationSeconds
          ? `timeLimit="${ctx.maxCallDurationSeconds}"`
          : "",
        ctx.recordCalls ? `record="record-from-answer-dual"` : "",
        ctx.recordCalls
          ? `recordingStatusCallback="${callbacks.recordingUrl}"`
          : "",
        ctx.recordCalls ? `recordingStatusCallbackMethod="POST"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(
        `  <Dial ${dialAttrs}>${escapeXml(ctx.forwardNumber)}</Dial>`,
      );
      lines.push(`</Response>`);
      return { contentType: "text/xml", body: lines.join("\n") };
    }

    // No forward target → record the caller (voicemail/intake style).
    if (ctx.recordCalls) {
      const recordAttrs = [
        `action="${callbacks.statusUrl}"`,
        `recordingStatusCallback="${callbacks.recordingUrl}"`,
        `recordingStatusCallbackMethod="POST"`,
        `transcribe="false"`,
        `playBeep="true"`,
        `finishOnKey="#"`,
        `maxLength="${ctx.maxCallDurationSeconds ?? 300}"`,
      ].join(" ");
      lines.push(`  <Record ${recordAttrs}/>`);
    } else {
      lines.push(
        `  <Say voice="Polly.Joanna">Thank you for calling. Goodbye.</Say>`,
      );
      lines.push(`  <Hangup/>`);
    }
    lines.push(`</Response>`);
    return { contentType: "text/xml", body: lines.join("\n") };
  },

  async downloadRecording(recordingUrl: string): Promise<Buffer | null> {
    const cfg = getTwilioConfig();
    if (!cfg.accountSid || !cfg.authToken) {
      logger.warn(
        "Twilio recording download skipped — credentials not configured",
      );
      return null;
    }
    // Twilio recording URLs return an HTML player by default; appending
    // `.wav` (or .mp3) gives us the raw media. Authenticated via Basic with
    // the account SID + auth token.
    const url = recordingUrl.endsWith(".wav") ? recordingUrl : `${recordingUrl}.wav`;
    const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString(
      "base64",
    );
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!res.ok) {
        logger.warn(
          { status: res.status, url },
          "Twilio recording fetch failed",
        );
        return null;
      }
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    } catch (err) {
      logger.error({ err, url }, "Twilio recording fetch threw");
      return null;
    }
  },
};
