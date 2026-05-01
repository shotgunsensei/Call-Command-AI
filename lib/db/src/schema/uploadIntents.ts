import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const UPLOAD_INTENT_STATUSES = [
  "pending",
  "uploaded",
  "attached",
  "expired",
] as const;
export type UploadIntentStatus = (typeof UPLOAD_INTENT_STATUSES)[number];

export const uploadIntentsTable = pgTable(
  "upload_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    workspaceId: varchar("workspace_id", { length: 64 }),
    objectPath: text("object_path").notNull().unique(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    maxSizeBytes: bigint("max_size_bytes", { mode: "number" }).notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    userIdx: index("upload_intents_user_idx").on(t.userId),
    statusIdx: index("upload_intents_status_idx").on(t.status),
    statusCheck: check(
      "upload_intents_status_check",
      sql`${t.status} in ('pending','uploaded','attached','expired')`,
    ),
  }),
);

export const insertUploadIntentSchema = createInsertSchema(
  uploadIntentsTable,
).omit({ id: true, createdAt: true });
export type InsertUploadIntent = z.infer<typeof insertUploadIntentSchema>;
export type UploadIntent = typeof uploadIntentsTable.$inferSelect;
