import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const callRecordsTable = pgTable("call_records", {
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
  suggestedTags: jsonb("suggested_tags").$type<string[]>().notNull().default([]),
  isDemo: text("is_demo").notNull().default("false"),
  errorMessage: text("error_message"),
  channelId: uuid("channel_id"),
  assignedUserId: varchar("assigned_user_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCallRecordSchema = createInsertSchema(callRecordsTable).omit(
  {
    id: true,
    createdAt: true,
    updatedAt: true,
  },
);
export type InsertCallRecord = z.infer<typeof insertCallRecordSchema>;
export type CallRecord = typeof callRecordsTable.$inferSelect;
