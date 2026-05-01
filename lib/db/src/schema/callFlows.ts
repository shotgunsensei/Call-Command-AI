import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const callFlowsTable = pgTable(
  "call_flows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    channelId: uuid("channel_id"),
    startNodeId: uuid("start_node_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("call_flows_user_idx").on(t.userId),
    channelIdx: index("call_flows_channel_idx").on(t.userId, t.channelId),
  }),
);

export const insertCallFlowSchema = createInsertSchema(callFlowsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCallFlow = z.infer<typeof insertCallFlowSchema>;
export type CallFlow = typeof callFlowsTable.$inferSelect;
