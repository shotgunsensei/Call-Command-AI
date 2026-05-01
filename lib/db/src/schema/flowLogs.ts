import {
  boolean,
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

export const flowLogsTable = pgTable(
  "flow_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    callRecordId: uuid("call_record_id").notNull(),
    flowId: uuid("flow_id"),
    nodeId: uuid("node_id"),
    nodeType: text("node_type").notNull(),
    nodeLabel: text("node_label"),
    branch: text("branch"),
    ok: boolean("ok").notNull().default(true),
    message: text("message"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    stepIndex: text("step_index"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    callIdx: index("flow_logs_call_idx").on(t.callRecordId),
    userIdx: index("flow_logs_user_idx").on(t.userId),
    flowIdx: index("flow_logs_flow_idx").on(t.flowId),
  }),
);

export const insertFlowLogSchema = createInsertSchema(flowLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFlowLog = z.infer<typeof insertFlowLogSchema>;
export type FlowLog = typeof flowLogsTable.$inferSelect;
