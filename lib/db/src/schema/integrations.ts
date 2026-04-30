import {
  boolean,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const integrationsTable = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id", { length: 64 }).notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  webhookUrl: text("webhook_url").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertIntegrationSchema = createInsertSchema(
  integrationsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;
export type Integration = typeof integrationsTable.$inferSelect;
