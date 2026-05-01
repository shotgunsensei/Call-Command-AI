/**
 * Provider-agnostic telephony interface. Each carrier integration
 * (Twilio, SIP webhook bridge, Asterisk ARI, FreePBX CDR) implements this
 * shape so the orchestrator core never has to know which carrier a call
 * came from.
 *
 * The current implementation only ships TwilioProvider; the SIP/Asterisk/
 * FreePBX modules are intentional placeholders so the surface area is
 * declared and a future contributor can fill them in without refactoring
 * the route layer.
 */

import type { Request } from "express";
import type { CallRecordStatus } from "@workspace/db";

export interface NormalizedIncoming {
  providerCallSid: string;
  fromNumber: string | null;
  toNumber: string | null;
  rawPayload: Record<string, unknown>;
}

export interface NormalizedStatus {
  providerCallSid: string;
  callStatus: CallRecordStatus;
  durationSeconds: number | null;
  rawPayload: Record<string, unknown>;
}

export interface NormalizedRecording {
  providerCallSid: string;
  recordingSid: string;
  recordingUrl: string;
  recordingDurationSeconds: number | null;
  rawPayload: Record<string, unknown>;
}

export interface ChannelTwiMLContext {
  greetingText: string | null;
  recordingConsentText: string | null;
  recordCalls: boolean;
  forwardNumber: string | null;
  maxCallDurationSeconds: number | null;
  /** Active channel resolved from the inbound `to` number. May be null
   * when no channel matches and no default is configured. */
  channelMatched: boolean;
}

/**
 * TwiML helpers used by the Phase 3 live-receptionist flow. These build
 * single-purpose response bodies (gather / transfer / voicemail / hangup)
 * the Twilio route handler chains together.
 */
export interface AiTwimlBuilders {
  /**
   * Build a `<Gather input="speech">` response that speaks `sayText` (or
   * the greeting on first turn) and POSTs the transcribed reply to
   * `gatherActionUrl`.
   */
  buildGatherResponse(args: {
    sayText: string;
    gatherActionUrl: string;
    /** Spoken when the gather times out without speech. */
    timeoutHangupText?: string;
    /** Twilio default is 5s. Set ≥3 to give callers room to think. */
    speechTimeout?: "auto" | number;
  }): { contentType: string; body: string };

  /**
   * Bridge the caller to a transfer target. When the dial ends, Twilio
   * will POST status to `statusUrl`. If `recordCalls` is true, recordings
   * are POSTed to `recordingUrl`.
   */
  buildTransferDial(args: {
    sayText?: string | null;
    phoneNumber: string;
    statusUrl: string;
    recordingUrl: string;
    recordCalls: boolean;
    maxCallDurationSeconds: number | null;
  }): { contentType: string; body: string };

  /**
   * Take a voicemail. Plays beep, records up to `maxLength` seconds, and
   * POSTs the recording to `recordingUrl`.
   */
  buildVoicemailRecord(args: {
    sayText: string;
    statusUrl: string;
    recordingUrl: string;
    maxLengthSeconds?: number;
  }): { contentType: string; body: string };

  buildHangup(args: { sayText: string }): { contentType: string; body: string };
}

export interface TelephonyProvider {
  readonly id: "twilio" | "sip" | "asterisk" | "freepbx";

  /** Verify the signature/auth on the incoming HTTP request. Returns true
   * when validation passes OR is intentionally disabled for the env. */
  validateRequest(req: Request): boolean;

  /** Convert the provider's incoming-call webhook payload into our shape. */
  parseIncoming(body: unknown): NormalizedIncoming | null;

  /** Convert the provider's status-callback payload. */
  parseStatus(body: unknown): NormalizedStatus | null;

  /** Convert the provider's recording-callback payload. Idempotency keys
   * (recordingSid) MUST be present. */
  parseRecording(body: unknown): NormalizedRecording | null;

  /** Build the response body (e.g. TwiML XML) for an incoming-call request.
   * Receives the resolved channel context plus the URLs Twilio should call
   * back into. */
  generateIncomingResponse(
    ctx: ChannelTwiMLContext,
    callbacks: {
      statusUrl: string;
      recordingUrl: string;
      transcriptionUrl: string;
    },
  ): { contentType: string; body: string };

  /** Fetch the recording bytes from the provider, returning a Buffer ready
   * for the analysis pipeline. */
  downloadRecording(recordingUrl: string): Promise<Buffer | null>;
}
