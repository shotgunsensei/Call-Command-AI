/**
 * Business-hours evaluator. Pure function over `channels.business_hours`
 * jsonb. Used by the Twilio incoming handler to branch into
 * `afterHoursBehavior` when the call lands outside the configured window.
 *
 * Rules:
 *   - Missing/empty config → always-on (callers are never accidentally
 *     locked out by an unconfigured channel).
 *   - `mode: "always"` → always-on.
 *   - `mode: "weekly"` → look up today's slot in `weekly[<day>]` (using
 *     the configured timezone, falling back to UTC). A null/missing slot
 *     for the day means "closed".
 *   - Slot times are `HH:MM` 24h strings. End < start is treated as an
 *     overnight window (e.g. 22:00 → 06:00 next day).
 *   - Malformed times never throw — they're treated as "closed" so we
 *     fall through to the after-hours branch (which is itself safe).
 */
import type { BusinessHours } from "@workspace/db";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type DayKey = (typeof DAY_KEYS)[number];

function dayKeyInTz(now: Date, timezone: string | undefined): DayKey {
  try {
    const tz = timezone || "UTC";
    const part = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: tz,
    })
      .format(now)
      .toLowerCase()
      .slice(0, 3) as DayKey;
    return DAY_KEYS.includes(part) ? part : DAY_KEYS[now.getUTCDay()]!;
  } catch {
    return DAY_KEYS[now.getUTCDay()]!;
  }
}

function minutesInTz(now: Date, timezone: string | undefined): number {
  try {
    const tz = timezone || "UTC";
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).formatToParts(now);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const m = parseInt(
      parts.find((p) => p.type === "minute")?.value ?? "0",
      10,
    );
    const safeH = isNaN(h) ? 0 : h % 24;
    const safeM = isNaN(m) ? 0 : m;
    return safeH * 60 + safeM;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

function parseHM(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function isWithinBusinessHours(
  hours: BusinessHours | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!hours) return true;
  if (hours.mode === "always") return true;
  if (!hours.weekly) return true;
  const dayKey = dayKeyInTz(now, hours.timezone);
  const slot = hours.weekly[dayKey];
  if (!slot) return false;
  const startMin = parseHM(slot.start);
  const endMin = parseHM(slot.end);
  if (startMin == null || endMin == null) return false;
  const cur = minutesInTz(now, hours.timezone);
  if (endMin > startMin) return cur >= startMin && cur < endMin;
  if (endMin < startMin) return cur >= startMin || cur < endMin; // overnight
  // start === end: zero-length slot, treat as closed.
  return false;
}
