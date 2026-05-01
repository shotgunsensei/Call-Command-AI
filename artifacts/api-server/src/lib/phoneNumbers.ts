/**
 * Lightweight E.164 normalization. We don't pull in libphonenumber-js
 * because it's heavyweight; for our use case we just need a deterministic
 * key for matching channels by phone number.
 *
 * Rules:
 *   - Trim whitespace, drop spaces / dashes / parentheses / dots.
 *   - If it already starts with `+`, keep the digits.
 *   - If it's 11 digits starting with `1` (NANP), prefix `+`.
 *   - If it's 10 digits, assume US/CA and prefix `+1`.
 *   - Otherwise just prefix `+` to whatever digits remain.
 *   - Return null for empty/garbage input.
 */
export function normalizeE164(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;

  if (hasPlus) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

/**
 * Returns true if `a` and `b` normalize to the same E.164 string. Useful for
 * lookups that can't run a full DB-side normalization (legacy rows might be
 * stored loosely formatted).
 */
export function phoneNumbersEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeE164(a);
  const nb = normalizeE164(b);
  if (!na || !nb) return false;
  return na === nb;
}
