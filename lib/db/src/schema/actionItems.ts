import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const actionItemsTable = pgTable("action_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  callRecordId: uuid("call_record_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertActionItemSchema = createInsertSchema(actionItemsTable).omit(
  {
    id: true,
    createdAt: true,
    updatedAt: true,
  },
);
export type InsertActionItem = z.infer<typeof insertActionItemSchema>;
export type ActionItem = typeof actionItemsTable.$inferSelect;
