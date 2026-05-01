/**
 * Intake schema engine. Pure functions over a `IntakeSchema` and the
 * caller's `collectedData` so far. The Twilio /gather route and the
 * live-call simulator both use these — keeping them dependency-free
 * makes them trivially testable.
 *
 * Design notes:
 *   - Order of `schema.fields` is significant: we ask for missing fields
 *     in declared order so operators can reason about transcripts.
 *   - We never throw on malformed schema — bad fields are skipped so a
 *     half-edited profile can never wedge a live call.
 *   - Answer parsing is intentionally loose. For `allowedValues` fields
 *     we do a case-insensitive keyword match; otherwise we just trim
 *     the raw speech result.
 */
import type {
  IntakeField,
  IntakeSchema,
} from "@workspace/db";

export interface IntakeState {
  /** Subset of `schema.fields` that are missing or invalid. */
  missing: IntakeField[];
  /** Next field to ask for (first item of `missing`), or null when complete. */
  next: IntakeField | null;
  /** True when every `required` field has a non-empty value. */
  complete: boolean;
}

function isFilled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function safeFields(schema: IntakeSchema | null | undefined): IntakeField[] {
  if (!schema || !Array.isArray(schema.fields)) return [];
  return schema.fields.filter(
    (f): f is IntakeField =>
      Boolean(f) && typeof f === "object" && typeof f.key === "string" && f.key.length > 0,
  );
}

export function evaluateIntake(
  schema: IntakeSchema | null | undefined,
  collectedData: Record<string, unknown> | null | undefined,
): IntakeState {
  const fields = safeFields(schema);
  const data = collectedData ?? {};
  const missing = fields.filter(
    (f) => f.required !== false && !isFilled(data[f.key]),
  );
  return {
    missing,
    next: missing[0] ?? null,
    complete: missing.length === 0,
  };
}

export function buildQuestionFor(field: IntakeField): string {
  if (field.prompt && field.prompt.trim()) return field.prompt.trim();
  const label = field.label?.trim() || field.key;
  if (field.allowedValues && field.allowedValues.length > 0) {
    return `What is the ${label}? Please say one of: ${field.allowedValues.join(", ")}.`;
  }
  return `What is the ${label}?`;
}

/**
 * Parse a single speech result into a value for the field we just asked
 * about. For free-text fields we just trim. For `allowedValues` we look
 * for the first allowed value mentioned (case-insensitive substring).
 * Returns the original (trimmed) text if no allowed value matches —
 * the AI decision service is the final arbiter for validity.
 */
export function parseAnswer(
  field: IntakeField,
  rawSpeech: string | null | undefined,
): string | null {
  const text = (rawSpeech ?? "").trim();
  if (!text) return null;
  if (field.allowedValues && field.allowedValues.length > 0) {
    const lower = text.toLowerCase();
    const hit = field.allowedValues.find((v) =>
      lower.includes(v.toLowerCase()),
    );
    return hit ?? text;
  }
  return text;
}

/**
 * Apply a parsed answer to collectedData immutably. Returns the new
 * object so callers can persist it without re-fetching.
 */
export function applyAnswer(
  collectedData: Record<string, unknown> | null | undefined,
  fieldKey: string,
  value: string,
): Record<string, unknown> {
  return { ...(collectedData ?? {}), [fieldKey]: value };
}
