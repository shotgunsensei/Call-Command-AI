import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Discriminated config shapes per node type.
 *
 * - `condition` — branches based on a single field/operator/value check.
 *   On match → `nextNodeId`; on miss → `nextNodeIdFalse`.
 * - `action` — runs an action descriptor (see actions.ts). Always proceeds
 *   to `nextNodeId`.
 * - `ai_decision` — re-runs analysis (or trusts existing analysis) and
 *   writes intent/priority/sentiment back to the call. Always proceeds.
 * - `route` — terminal: assigns the call/related entities to a user/queue,
 *   escalates, or ends the flow.
 */
export type ConditionConfig = {
  field: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "in"
    | "exists"
    | "gt"
    | "lt";
  value?: unknown;
};

export type ActionConfig =
  | { type: "create_ticket"; titleTemplate?: string }
  | { type: "create_lead" }
  | { type: "create_task"; titleTemplate?: string; dueInDays?: number }
  | { type: "send_webhook"; integrationId?: string; url?: string }
  | { type: "send_slack"; integrationId: string; messageTemplate?: string }
  | { type: "send_email"; to: string; subjectTemplate?: string }
  | { type: "assign_user"; assigneeId: string }
  | { type: "mark_priority"; priority: "low" | "medium" | "high" | "urgent" };

export type AiDecisionConfig = {
  reanalyze?: boolean;
};

export type RouteConfig = {
  mode: "assign_user" | "assign_queue" | "escalate" | "end";
  assigneeId?: string;
  queue?: string;
};

export type NodeConfig =
  | ConditionConfig
  | ActionConfig
  | AiDecisionConfig
  | RouteConfig;

export const flowNodesTable = pgTable(
  "flow_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flowId: uuid("flow_id").notNull(),
    type: text("type").notNull(),
    label: text("label"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    nextNodeId: uuid("next_node_id"),
    nextNodeIdFalse: uuid("next_node_id_false"),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    flowIdx: index("flow_nodes_flow_idx").on(t.flowId),
  }),
);

export const insertFlowNodeSchema = createInsertSchema(flowNodesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFlowNode = z.infer<typeof insertFlowNodeSchema>;
export type FlowNode = typeof flowNodesTable.$inferSelect;
