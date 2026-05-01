/**
 * Escalation rules evaluator. Given a receptionist profile + the current
 * call signals, returns whether to escalate and (optionally) a transfer
 * target id to dial. Pure function — no IO, easy to unit test and reason
 * about during a hot Gather webhook.
 */
import type { EscalationRules } from "@workspace/db";

export interface EscalationInput {
  rules: EscalationRules | null | undefined;
  callerPhone: string | null;
  /** Latest sentiment from AI decision (lowercased). */
  sentiment: string | null;
  /** Cumulative transcript so far. We scan for emergency keywords here. */
  transcriptSnippet: string | null;
}

export interface EscalationResult {
  triggered: boolean;
  /** Short, operator-facing reason ("VIP caller", "Emergency keyword: ..."). */
  reason: string | null;
  /** Optional transfer target to dial when triggered. */
  transferTargetId: string | null;
}

const NO_ESCALATION: EscalationResult = {
  triggered: false,
  reason: null,
  transferTargetId: null,
};

export function evaluateEscalation(input: EscalationInput): EscalationResult {
  const rules = input.rules ?? {};
  // VIP caller — highest priority match so it overrides keyword/sentiment.
  if (
    Array.isArray(rules.vipNumbers) &&
    rules.vipNumbers.length > 0 &&
    input.callerPhone
  ) {
    const caller = input.callerPhone.trim();
    if (rules.vipNumbers.some((n) => n.trim() === caller)) {
      return {
        triggered: true,
        reason: "VIP caller",
        transferTargetId: rules.afterHoursEmergencyTransferTargetId ?? null,
      };
    }
  }
  // Emergency keyword — substring match on the cumulative transcript.
  if (
    Array.isArray(rules.emergencyKeywords) &&
    rules.emergencyKeywords.length > 0 &&
    input.transcriptSnippet
  ) {
    const hay = input.transcriptSnippet.toLowerCase();
    const hit = rules.emergencyKeywords
      .map((k) => k.trim())
      .filter(Boolean)
      .find((k) => hay.includes(k.toLowerCase()));
    if (hit) {
      return {
        triggered: true,
        reason: `Emergency keyword: "${hit}"`,
        transferTargetId: rules.afterHoursEmergencyTransferTargetId ?? null,
      };
    }
  }
  // Angry sentiment — opt-in trigger.
  if (
    rules.angrySentimentEscalates === true &&
    input.sentiment &&
    ["angry", "frustrated"].includes(input.sentiment.toLowerCase())
  ) {
    return {
      triggered: true,
      reason: `Caller sentiment: ${input.sentiment}`,
      transferTargetId: rules.afterHoursEmergencyTransferTargetId ?? null,
    };
  }
  return NO_ESCALATION;
}
