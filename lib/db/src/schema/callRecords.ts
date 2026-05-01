import {
  index,
  integer,
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
 * call_records.status is a free-form text column. The valid values are kept
 * here as an exported union so the UI mapper and engine code share the
 * vocabulary; we deliberately do NOT use a pg enum so that adding new
 * statuses doesn't require a schema migration.
 *
 * Legacy aliases (`processing`, `ready`) remain valid — the UI mapper folds
 * the new finer-grained states (transcribing/analyzing/flow_running) back
 * into them where needed.
 */
export const CALL_RECORD_STATUSES = [
  // Legacy / pre-Phase-2
  "processing",
  "ready",
  "error",
  // Phase 2 — telephony lifecycle
  "incoming",
  "ringing",
  "in_progress",
  "recording_ready",
  "transcribing",
  "analyzing",
  "flow_running",
  "completed",
  "failed",
  "busy",
  "no_answer",
] as const;
export type CallRecordStatus = (typeof CALL_RECORD_STATUSES)[number];

export const callRecordsTable = pgTable(
  "call_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    originalFilename: text("original_filename").notNull(),
    fileUrl: text("file_url"),
    transcriptText: text("transcript_text"),
    summary: text("summary"),
    customerName: text("customer_name"),
    companyName: text("company_name"),
    callerPhone: text("caller_phone"),
    callType: text("call_type"),
    intent: text("intent"),
    priority: text("priority"),
    sentiment: text("sentiment"),
    status: text("status").notNull().default("processing"),
    durationSeconds: integer("duration_seconds"),
    keyPoints: jsonb("key_points").$type<string[]>().notNull().default([]),
    followUpMessage: text("follow_up_message"),
    internalNotes: text("internal_notes"),
    crmJson: jsonb("crm_json").$type<Record<string, unknown>>(),
    suggestedTags: jsonb("suggested_tags")
      .$type<string[]>()
      .notNull()
      .default([]),
    isDemo: text("is_demo").notNull().default("false"),
    errorMessage: text("error_message"),
    channelId: uuid("channel_id"),
    assignedUserId: varchar("assigned_user_id", { length: 64 }),
    // Phase 2 — telephony provenance
    provider: text("provider"),
    providerCallSid: text("provider_call_sid"),
    calledNumber: text("called_number"),
    callDirection: text("call_direction"),
    recordingUrl: text("recording_url"),
    recordingSid: text("recording_sid"),
    recordingDurationSeconds: integer("recording_duration_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("call_records_user_idx").on(t.userId),
    providerSidIdx: index("call_records_provider_sid_idx").on(
      t.providerCallSid,
    ),
    // recording_sid is unique globally — Twilio only emits one per recording
    // and we use it for idempotent recording-callback handling.
    recordingSidIdx: uniqueIndex("call_records_recording_sid_idx").on(
      t.recordingSid,
    ),
  }),
);

export const insertCallRecordSchema = createInsertSchema(callRecordsTable).omit(
  {
    id: true,
    createdAt: true,
    updatedAt: true,
  },
);
export type InsertCallRecord = z.infer<typeof insertCallRecordSchema>;
export type CallRecord = typeof callRecordsTable.$inferSelect;
