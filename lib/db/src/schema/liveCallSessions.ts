import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Live call sessions are the runtime state for an in-progress AI receptionist
 * conversation. They live alongside `call_records` (one-to-one for live calls
 * — uploads/simulator never create a live session).
 *
 * Status vocabulary:
 *   - `active`             — call connected, not yet collecting intake
 *   - `collecting_intake`  — multi-turn Gather loop in progress
 *   - `transferring`       — attempting to bridge to a transfer target
 *   - `voicemail`          — caller diverted to voicemail (recording pending)
 *   - `completed`          — gracefully ended (intake done / hangup)
 *   - `failed`             — provider/AI error; safe TwiML hangup returned
 */
export const LIVE_SESSION_STATUSES = [
  "active",
  "collecting_intake",
  "transferring",
  "voicemail",
  "completed",
  "failed",
] as const;
export type LiveSessionStatus = (typeof LIVE_SESSION_STATUSES)[number];

/**
 * Note appended manually by an operator from the switchboard. Stored inline
 * (not a separate table) — these are low-volume per session.
 */
export interface LiveSessionNote {
  authorUserId: string;
  body: string;
  createdAt: string;
}

export const liveCallSessionsTable = pgTable(
  "live_call_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    channelId: uuid("channel_id"),
    callRecordId: uuid("call_record_id"),
    receptionistProfileId: uuid("receptionist_profile_id"),
    provider: text("provider"),
    providerCallSid: text("provider_call_sid"),
    callerPhone: text("caller_phone"),
    calledNumber: text("called_number"),
    sessionStatus: text("session_status")
      .$type<LiveSessionStatus>()
      .notNull()
      .default("active"),
    /** Free-form step label for UI display, e.g. "asking caller_name". */
    currentStep: text("current_step"),
    /** Last intake field key we asked for; lets gather replies bind by key. */
    lastQuestionKey: text("last_question_key"),
    askedFieldKeys: jsonb("asked_field_keys").$type<string[]>().notNull().default([]),
    collectedData: jsonb("collected_data")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    transcriptLive: text("transcript_live").notNull().default(""),
    aiSummaryLive: text("ai_summary_live"),
    /** Latest detected intent/priority/sentiment for switchboard display. */
    intent: text("intent"),
    priority: text("priority"),
    sentiment: text("sentiment"),
    /** Currently selected transfer target (id or freeform name). */
    transferTarget: text("transfer_target"),
    escalationReason: text("escalation_reason"),
    /** Operator notes attached during/after the call. */
    notes: jsonb("notes").$type<LiveSessionNote[]>().notNull().default([]),
    /**
     * Per-session de-duplication so a noisy AI loop never creates two tickets
     * for the same call. Keys are object-type ("ticket"|"lead"|"task"), values
     * are the created object's id.
     */
    createdObjectIds: jsonb("created_object_ids")
      .$type<Partial<Record<"ticket" | "lead" | "task", string>>>()
      .notNull()
      .default({}),
    /** Marker so the simulator never leaks into production reports. */
    isDemo: text("is_demo").notNull().default("false"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("live_call_sessions_user_idx").on(t.userId),
    callIdx: index("live_call_sessions_call_idx").on(t.callRecordId),
    /**
     * One live session per provider CallSid — Twilio retried gather posts hit
     * the same row. NULLs are allowed (e.g. simulator sessions) and Postgres
     * treats them as distinct so no collision.
     */
    sidIdx: uniqueIndex("live_call_sessions_provider_sid_idx").on(
      t.providerCallSid,
    ),
  }),
);

export const insertLiveCallSessionSchema = createInsertSchema(
  liveCallSessionsTable,
).omit({ id: true, startedAt: true, updatedAt: true });
export type InsertLiveCallSession = z.infer<typeof insertLiveCallSessionSchema>;
export type LiveCallSession = typeof liveCallSessionsTable.$inferSelect;
