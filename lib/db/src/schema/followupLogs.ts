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

export const followupLogsTable = pgTable(
  "followup_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    callRecordId: uuid("call_record_id").notNull(),
    channel: text("channel").notNull().default("email"),
    recipient: text("recipient"),
    subject: text("subject"),
    message: text("message").notNull(),
    status: text("status").notNull().default("sent"),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("followup_logs_user_idx").on(t.userId),
    callIdx: index("followup_logs_call_idx").on(t.callRecordId),
  }),
);

export const insertFollowupLogSchema = createInsertSchema(
  followupLogsTable,
).omit({ id: true, sentAt: true });
export type InsertFollowupLog = z.infer<typeof insertFollowupLogSchema>;
export type FollowupLog = typeof followupLogsTable.$inferSelect;
