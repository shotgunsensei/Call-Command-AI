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
 * Append-only log of every telephony provider webhook we receive (incoming,
 * status, recording, transcription, error). This is the audit trail for the
 * orchestrator — each row links back to the call_record it relates to (when
 * we can match one). Keeping the full raw payload lets us debug provider
 * quirks without re-running calls.
 */
export const telephonyEventsTable = pgTable(
  "telephony_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    callRecordId: uuid("call_record_id"),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    providerEventId: text("provider_event_id"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("telephony_events_user_idx").on(t.userId),
    callIdx: index("telephony_events_call_idx").on(t.callRecordId),
    // (provider, providerEventId) lets recording/status callbacks dedupe
    // when the carrier retries. NULLs are allowed (Postgres treats NULL as
    // distinct in unique indexes by default).
    providerEventIdx: uniqueIndex("telephony_events_provider_event_idx").on(
      t.provider,
      t.providerEventId,
    ),
  }),
);

export const insertTelephonyEventSchema = createInsertSchema(
  telephonyEventsTable,
).omit({ id: true, createdAt: true });
export type InsertTelephonyEvent = z.infer<typeof insertTelephonyEventSchema>;
export type TelephonyEvent = typeof telephonyEventsTable.$inferSelect;
