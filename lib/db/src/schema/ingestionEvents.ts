import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ingestionEventsTable = pgTable(
  "ingestion_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    source: text("source").notNull(),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    callRecordId: uuid("call_record_id"),
    status: text("status").notNull().default("accepted"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("ingestion_events_user_idx").on(t.userId),
    sourceIdx: index("ingestion_events_source_idx").on(t.userId, t.source),
  }),
);

export const insertIngestionEventSchema = createInsertSchema(
  ingestionEventsTable,
).omit({ id: true, createdAt: true });
export type InsertIngestionEvent = z.infer<typeof insertIngestionEventSchema>;
export type IngestionEvent = typeof ingestionEventsTable.$inferSelect;
