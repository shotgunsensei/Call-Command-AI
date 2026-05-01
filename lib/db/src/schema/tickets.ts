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

export const ticketsTable = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    linkedCallId: uuid("linked_call_id"),
    createdByRuleId: uuid("created_by_rule_id"),
    assignedUserId: varchar("assigned_user_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("tickets_user_idx").on(t.userId),
    statusIdx: index("tickets_status_idx").on(t.userId, t.status),
  }),
);

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
