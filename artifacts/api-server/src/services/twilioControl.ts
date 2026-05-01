/**
 * Out-of-band Twilio call control. Used by the operator switchboard to
 * actually redirect a live call (not just log a "transfer requested"
 * intent). Backed by Twilio's REST `Calls/{Sid}` update endpoint with an
 * inline `Twiml=` parameter.
 *
 * https://www.twilio.com/docs/voice/api/call-resource#update-a-call-resource
 *
 * If Twilio is not configured we return a structured `logged_no_provider`
 * result so the caller can surface an explicit message to the operator
 * instead of silently pretending the redirect happened.
 */
import { getTwilioConfig } from "../lib/twilio";
import { logger } from "../lib/logger";

export type TwilioRedirectStatus =
  | "redirected"
  | "logged_no_provider"
  | "no_call_sid"
  | "no_target_phone"
  | "failed";

export interface TwilioRedirectResult {
  ok: boolean;
  status: TwilioRedirectStatus;
  reason: string;
  /** HTTP status returned by Twilio (when we got that far). */
  twilioStatus?: number;
}

/**
 * Map a redirect status to the `transfer_logs.status` enum so we can
 * persist a meaningful audit row regardless of which path we took.
 *   - `redirected` → `bridged` (Twilio accepted our redirect; the bridge
 *     itself is what the operator wanted)
 *   - `failed` / `logged_no_provider` / `no_*` → `failed` (we never
 *     reached a connected state)
 */
export function redirectStatusToTransferLog(
  s: TwilioRedirectStatus,
): "bridged" | "failed" {
  return s === "redirected" ? "bridged" : "failed";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface RedirectArgs {
  callSid: string | null | undefined;
  targetPhoneE164: string | null | undefined;
  sayText?: string | null;
  recordCalls?: boolean;
  /** Optional public URL Twilio will POST to once the bridged leg ends. */
  statusCallbackUrl?: string | null;
  recordingCallbackUrl?: string | null;
}

export async function redirectLiveCallToDial(
  args: RedirectArgs,
): Promise<TwilioRedirectResult> {
  if (!args.callSid) {
    return {
      ok: false,
      status: "no_call_sid",
      reason: "Live session has no provider CallSid (simulator / non-Twilio call)",
    };
  }
  if (!args.targetPhoneE164) {
    return {
      ok: false,
      status: "no_target_phone",
      reason: "Transfer target has no phone number — cannot redirect",
    };
  }
  const cfg = getTwilioConfig();
  if (!cfg.accountSid || !cfg.authToken) {
    return {
      ok: false,
      status: "logged_no_provider",
      reason:
        "Twilio not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN missing); transfer logged only",
    };
  }

  const sayPart = args.sayText
    ? `<Say voice="Polly.Joanna">${escapeXml(args.sayText)}</Say>`
    : "";
  const dialAttrs = [
    args.recordCalls ? `record="record-from-answer-dual"` : "",
    args.recordingCallbackUrl && args.recordCalls
      ? `recordingStatusCallback="${escapeXml(args.recordingCallbackUrl)}"`
      : "",
    args.recordingCallbackUrl && args.recordCalls
      ? `recordingStatusCallbackMethod="POST"`
      : "",
    args.statusCallbackUrl
      ? `action="${escapeXml(args.statusCallbackUrl)}" method="POST"`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>${sayPart}<Dial ${dialAttrs}>${escapeXml(
    args.targetPhoneE164,
  )}</Dial></Response>`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    cfg.accountSid,
  )}/Calls/${encodeURIComponent(args.callSid)}.json`;
  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString(
    "base64",
  );
  const form = new URLSearchParams({ Twiml: twiml });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.warn(
        { status: res.status, callSid: args.callSid },
        "Twilio call redirect failed",
      );
      return {
        ok: false,
        status: "failed",
        reason: `Twilio API ${res.status}: ${text.slice(0, 200)}`,
        twilioStatus: res.status,
      };
    }
    return {
      ok: true,
      status: "redirected",
      reason: "Live call redirected via Twilio Calls API",
      twilioStatus: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
