import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Audit log for every transfer attempt — both successful bridges and
 * fall-throughs to voicemail. Lets the switchboard show "tried target X,
 * fell through to Y" for accountability.
 */
export type TransferLogStatus =
  | "attempted"
  | "bridged"
  | "no_answer"
  | "busy"
  | "failed"
  | "fell_through_to_voicemail";

export const transferLogsTable = pgTable(
  "transfer_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    callRecordId: uuid("call_record_id"),
    liveSessionId: uuid("live_session_id"),
    targetId: uuid("target_id"),
    /** Snapshot of the target name at the time of the transfer. */
    targetName: text("target_name"),
    status: text("status").$type<TransferLogStatus>().notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("transfer_logs_user_idx").on(t.userId),
    callIdx: index("transfer_logs_call_idx").on(t.callRecordId),
    sessionIdx: index("transfer_logs_session_idx").on(t.liveSessionId),
  }),
);

export const insertTransferLogSchema = createInsertSchema(
  transferLogsTable,
).omit({ id: true, createdAt: true });
export type InsertTransferLog = z.infer<typeof insertTransferLogSchema>;
export type TransferLog = typeof transferLogsTable.$inferSelect;
