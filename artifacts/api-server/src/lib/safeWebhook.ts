import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a = 0, b = 0] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIPv6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a === "::1" || a === "::") return true;
  if (a.startsWith("fc") || a.startsWith("fd")) return true; // unique local
  if (a.startsWith("fe80")) return true; // link-local
  if (a.startsWith("ff")) return true; // multicast
  if (a.startsWith("::ffff:")) {
    return isPrivateIPv4(a.slice(7));
  }
  return false;
}

export function validateWebhookUrl(raw: string): {
  ok: boolean;
  error?: string;
  url?: URL;
} {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Webhook must be http(s)" };
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, error: "Webhook host is not allowed" };
  }
  if (host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, error: "Webhook host is not allowed" };
  }
  return { ok: true, url };
}

export async function safeFetchWebhook(
  raw: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const v = validateWebhookUrl(raw);
  if (!v.ok || !v.url) {
    throw new Error(v.error ?? "Invalid webhook URL");
  }
  const url = v.url;

  // Resolve all addresses for the host and reject any that point at private
  // ranges. This blocks DNS-rebinding to internal services.
  let host = url.hostname;
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  const ipFamily = isIP(host);
  if (ipFamily === 4 && isPrivateIPv4(host)) {
    throw new Error("Webhook target resolves to a private address");
  }
  if (ipFamily === 6 && isPrivateIPv6(host)) {
    throw new Error("Webhook target resolves to a private address");
  }
  if (ipFamily === 0) {
    const records = await lookup(host, { all: true });
    for (const r of records) {
      if (r.family === 4 && isPrivateIPv4(r.address)) {
        throw new Error("Webhook target resolves to a private address");
      }
      if (r.family === 6 && isPrivateIPv6(r.address)) {
        throw new Error("Webhook target resolves to a private address");
      }
    }
  }

  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? 7000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "manual",
    });
  } finally {
    clearTimeout(timeout);
  }
}
