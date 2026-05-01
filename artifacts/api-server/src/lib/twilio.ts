import crypto from "crypto";
import type { Request } from "express";

export interface TwilioConfig {
  accountSid: string | null;
  authToken: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  webhookBaseUrl: string | null;
  defaultRecordCalls: boolean;
  validateSignature: boolean;
}

function envStr(key: string): string | null {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : null;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v == null) return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

/**
 * Read the live Twilio configuration. Never cached — env can change between
 * dev restarts and we want the wizard to reflect that immediately.
 */
export function getTwilioConfig(): TwilioConfig {
  return {
    accountSid: envStr("TWILIO_ACCOUNT_SID"),
    authToken: envStr("TWILIO_AUTH_TOKEN"),
    apiKey: envStr("TWILIO_API_KEY"),
    apiSecret: envStr("TWILIO_API_SECRET"),
    webhookBaseUrl: envStr("TWILIO_WEBHOOK_BASE_URL"),
    defaultRecordCalls: envBool("TWILIO_DEFAULT_RECORD_CALLS", true),
    validateSignature: envBool("TWILIO_VALIDATE_SIGNATURE", true),
  };
}

/**
 * Twilio is "configured" if we have at least an account SID + auth token.
 * The API key/secret pair is optional (used for outbound, not webhooks).
 */
export function isTwilioConfigured(cfg: TwilioConfig = getTwilioConfig()): boolean {
  return Boolean(cfg.accountSid && cfg.authToken);
}

/**
 * Resolve the public base URL Twilio should call back to. Priority:
 *   1. TWILIO_WEBHOOK_BASE_URL (explicit override).
 *   2. The first entry in REPLIT_DOMAINS prefixed with https://.
 *   3. null — UI will surface a "configure your webhook URL" warning.
 */
export function getWebhookBaseUrl(
  cfg: TwilioConfig = getTwilioConfig(),
): string | null {
  if (cfg.webhookBaseUrl) return cfg.webhookBaseUrl.replace(/\/$/, "");
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains && domains.trim()) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  return null;
}

/**
 * Twilio's HTTP signature scheme:
 *   sig = base64( HMAC-SHA1(authToken, url + sortedParamsConcatenated) )
 *
 * For form-encoded POSTs the params concatenation is the alphabetically
 * sorted (key, value) pairs joined with no separator. For JSON bodies it's
 * just the URL.
 *
 * We rebuild the URL from the request — but the inbound URL is whatever
 * Twilio dialed, so when we're behind the Replit proxy we have to use the
 * original public URL. The caller passes us `publicUrl` so the route layer
 * can construct it from getWebhookBaseUrl() + req.originalUrl.
 */
export function validateTwilioSignature(args: {
  authToken: string;
  signature: string;
  publicUrl: string;
  params: Record<string, string>;
}): boolean {
  const { authToken, signature, publicUrl, params } = args;
  if (!authToken || !signature || !publicUrl) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = publicUrl;
  for (const k of sortedKeys) {
    data += k + (params[k] ?? "");
  }
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");
  // Constant-time compare to avoid timing oracles.
  const sigBuf = Buffer.from(signature, "utf-8");
  const expBuf = Buffer.from(expected, "utf-8");
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Coerce arbitrary form bodies (which may have nested arrays) into a
 * flat string-only map for signature validation.
 */
export function flattenForm(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body || typeof body !== "object") return out;
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    else if (Array.isArray(v)) out[k] = v.map((x) => String(x)).join(",");
    else out[k] = JSON.stringify(v);
  }
  return out;
}

export function rebuildPublicUrl(req: Request): string | null {
  const base = getWebhookBaseUrl();
  if (!base) return null;
  // req.originalUrl includes the query string; Twilio computes signature
  // over the *exact* URL it dialed.
  return `${base}${req.originalUrl}`;
}
