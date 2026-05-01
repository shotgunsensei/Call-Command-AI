/**
 * Live AI receptionist decision service. Given the receptionist profile,
 * channel, current intake state, and the caller's latest utterance,
 * returns a single structured decision the gather route can act on.
 *
 * Hard rules:
 *   - Server-side AI keys only. Prompt body is never returned to clients.
 *   - When OpenAI is not configured OR malformed JSON comes back, we fall
 *     back to a deterministic algorithm that uses the intake engine to
 *     keep the conversation moving forward. The fallback is good enough
 *     to demo Phase 3 end-to-end without an AI key.
 *   - Strict output shape — invalid model output is normalized rather
 *     than thrown.
 *   - For Medical mode, the system prompt explicitly forbids any clinical
 *     or diagnostic language — administrative routing only.
 */
import { z } from "zod/v4";
import type {
  Channel,
  IntakeSchema,
  ReceptionistProfile,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  applyAnswer,
  buildQuestionFor,
  evaluateIntake,
  parseAnswer,
} from "../lib/intakeEngine";
import { evaluateEscalation } from "../lib/escalation";

const HAS_OPENAI =
  Boolean(process.env["AI_INTEGRATIONS_OPENAI_API_KEY"]) &&
  Boolean(process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]);

export const DECISION_ACTIONS = [
  "ask_next",
  "transfer",
  "voicemail",
  "create_ticket",
  "create_lead",
  "create_task",
  "escalate",
  "end_call",
] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export const PRIORITIES = ["low", "normal", "high", "emergency"] as const;
export const SENTIMENTS = [
  "positive",
  "neutral",
  "frustrated",
  "angry",
  "confused",
] as const;

export interface ReceptionistDecision {
  intent: string;
  priority: (typeof PRIORITIES)[number];
  sentiment: (typeof SENTIMENTS)[number];
  collectedDataUpdates: Record<string, unknown>;
  nextQuestion: string | null;
  recommendedAction: DecisionAction;
  reason: string;
  transferTarget: string | null;
  publicResponse: string;
  internalNote: string;
}

export interface DecisionInput {
  profile: ReceptionistProfile;
  channel: Channel | null;
  collectedData: Record<string, unknown>;
  /** Last intake field key we asked for; used to bind the answer when present. */
  lastQuestionKey: string | null;
  /** Cumulative transcript so far (caller + AI), oldest-first. */
  transcript: string;
  /** The caller's most recent utterance from Twilio Gather. */
  latestSpeech: string;
  /** Caller phone number in E.164 if known. */
  callerPhone: string | null;
}

const decisionSchema = z.object({
  intent: z.string().default(""),
  priority: z.enum(PRIORITIES).default("normal"),
  sentiment: z.enum(SENTIMENTS).default("neutral"),
  collected_data_updates: z.record(z.string(), z.unknown()).default({}),
  next_question: z.string().nullable().default(null),
  recommended_action: z.enum(DECISION_ACTIONS).default("ask_next"),
  reason: z.string().default(""),
  transfer_target: z.string().nullable().default(null),
  public_response: z.string().default(""),
  internal_note: z.string().default(""),
});

function buildSystemPrompt(profile: ReceptionistProfile): string {
  const tone = profile.tone ?? "professional";
  const isMedical = profile.productMode === "medical";
  const medicalGuard = isMedical
    ? `\nMEDICAL/OFFICE MODE: This is administrative intake ONLY. You must NEVER offer any medical, clinical, diagnostic, or treatment advice. You may ONLY collect administrative routing information (caller name, callback number, request type, preferred callback time). If the caller describes symptoms, politely say you will route them to staff and continue collecting administrative info only.`
    : "";
  return [
    `You are a live phone receptionist for the workspace's "${profile.name}" line.`,
    `Tone: ${tone}.`,
    `Greeting was: "${profile.greetingScript}".`,
    `Your job is to collect required intake fields, decide whether to transfer, take voicemail, create a business object, escalate, or end the call.`,
    `Never make automotive diagnostic claims. Never make medical diagnostic or triage claims.`,
    medicalGuard,
    `Return ONLY a JSON object. No prose, no code fences. Fields: intent, priority (low|normal|high|emergency), sentiment (positive|neutral|frustrated|angry|confused), collected_data_updates (object), next_question (string|null), recommended_action (ask_next|transfer|voicemail|create_ticket|create_lead|create_task|escalate|end_call), reason, transfer_target (string|null), public_response (what you will say to the caller next, no SSML), internal_note.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserPrompt(input: DecisionInput): string {
  const schema = input.profile.intakeSchema as IntakeSchema | null;
  const fields = schema?.fields ?? [];
  return [
    `Intake schema fields:`,
    JSON.stringify(fields, null, 2),
    ``,
    `Currently collected data:`,
    JSON.stringify(input.collectedData, null, 2),
    ``,
    input.lastQuestionKey
      ? `You just asked the caller for the field "${input.lastQuestionKey}".`
      : `You have not yet asked any specific intake question this turn.`,
    ``,
    `Cumulative transcript so far:`,
    input.transcript || "(empty)",
    ``,
    `Caller's most recent utterance:`,
    `"${input.latestSpeech}"`,
    ``,
    `Caller phone: ${input.callerPhone ?? "unknown"}.`,
    ``,
    `Decide the next action and return strict JSON.`,
  ].join("\n");
}

async function callOpenAI(args: {
  system: string;
  user: string;
}): Promise<unknown> {
  const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"]!;
  const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]!;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.4",
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content);
}

function fallbackDecision(input: DecisionInput): ReceptionistDecision {
  // Bind the latest speech to the field we asked for, then re-evaluate
  // intake to find the next missing field.
  let updatedCollected = input.collectedData;
  const updates: Record<string, unknown> = {};
  if (input.lastQuestionKey) {
    const field = (input.profile.intakeSchema as IntakeSchema | null)?.fields?.find(
      (f) => f.key === input.lastQuestionKey,
    );
    if (field) {
      const parsed = parseAnswer(field, input.latestSpeech);
      if (parsed) {
        updates[field.key] = parsed;
        updatedCollected = applyAnswer(updatedCollected, field.key, parsed);
      }
    }
  }

  const state = evaluateIntake(
    input.profile.intakeSchema as IntakeSchema | null,
    updatedCollected,
  );

  // Run escalation rules deterministically — even with no AI we still
  // honor VIP / emergency keyword / angry sentiment triggers.
  const escalation = evaluateEscalation({
    rules: input.profile.escalationRules,
    callerPhone: input.callerPhone,
    sentiment: null,
    transcriptSnippet: `${input.transcript}\n${input.latestSpeech}`,
  });

  if (escalation.triggered) {
    return {
      intent: "escalate",
      priority: "emergency",
      sentiment: "neutral",
      collectedDataUpdates: updates,
      nextQuestion: null,
      recommendedAction: escalation.transferTargetId ? "transfer" : "escalate",
      reason: escalation.reason ?? "Escalation triggered",
      transferTarget: escalation.transferTargetId,
      publicResponse:
        "Thank you. I'm connecting you with someone who can help right away.",
      internalNote: `Auto-escalated: ${escalation.reason ?? "rule match"}`,
    };
  }

  if (state.complete) {
    // Default: with intake done, hand off to a follow-up object based on
    // product mode hints. The caller-facing voice line stays neutral.
    const action: DecisionAction =
      input.profile.productMode === "sales"
        ? "create_lead"
        : input.profile.productMode === "field_service" ||
            input.profile.productMode === "medical"
          ? "create_task"
          : "create_ticket";
    return {
      intent: "intake_complete",
      priority: "normal",
      sentiment: "neutral",
      collectedDataUpdates: updates,
      nextQuestion: null,
      recommendedAction: action,
      reason: "All required intake fields collected",
      transferTarget: null,
      publicResponse:
        "Thank you. I have what I need. We'll be in touch shortly. Goodbye.",
      internalNote: "Intake complete via deterministic fallback.",
    };
  }

  const next = state.next!;
  return {
    intent: "collect_intake",
    priority: "normal",
    sentiment: "neutral",
    collectedDataUpdates: updates,
    nextQuestion: next.key,
    recommendedAction: "ask_next",
    reason: `Need more info for "${next.key}"`,
    transferTarget: null,
    publicResponse: buildQuestionFor(next),
    internalNote: "Deterministic fallback (no AI).",
  };
}

function normalizeAiOutput(
  raw: unknown,
  input: DecisionInput,
): ReceptionistDecision {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(
      { err: parsed.error.message },
      "liveReceptionist: AI output failed schema, using fallback",
    );
    return fallbackDecision(input);
  }
  const d = parsed.data;
  // If the model said "ask_next" but didn't supply a question, fill one
  // from the intake engine so the call never silently stalls.
  let publicResponse = d.public_response.trim();
  let nextQuestionKey = d.next_question;
  if (
    d.recommended_action === "ask_next" &&
    (!publicResponse || !nextQuestionKey)
  ) {
    const collectedAfterUpdates = {
      ...input.collectedData,
      ...d.collected_data_updates,
    };
    const state = evaluateIntake(
      input.profile.intakeSchema as IntakeSchema | null,
      collectedAfterUpdates,
    );
    if (state.next) {
      nextQuestionKey = state.next.key;
      if (!publicResponse) publicResponse = buildQuestionFor(state.next);
    } else {
      publicResponse =
        publicResponse ||
        "Thank you. I have what I need. We'll be in touch shortly. Goodbye.";
    }
  }
  return {
    intent: d.intent,
    priority: d.priority,
    sentiment: d.sentiment,
    collectedDataUpdates: d.collected_data_updates,
    nextQuestion: nextQuestionKey,
    recommendedAction: d.recommended_action,
    reason: d.reason,
    transferTarget: d.transfer_target,
    publicResponse,
    internalNote: d.internal_note,
  };
}

export async function decideNextStep(
  input: DecisionInput,
): Promise<ReceptionistDecision> {
  if (!HAS_OPENAI) {
    return fallbackDecision(input);
  }
  try {
    const raw = await callOpenAI({
      system: buildSystemPrompt(input.profile),
      user: buildUserPrompt(input),
    });
    return normalizeAiOutput(raw, input);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "liveReceptionist: AI call failed, using fallback",
    );
    return fallbackDecision(input);
  }
}
