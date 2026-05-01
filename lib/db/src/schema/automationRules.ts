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

export type RuleCondition = {
  callType?: string | string[];
  intent?: string | string[];
  priority?: string | string[];
  sentiment?: string | string[];
  tagIncludes?: string | string[];
  isDemo?: boolean;
};

export type RuleAction =
  | { type: "create_ticket"; titleTemplate?: string }
  | { type: "create_lead" }
  | { type: "create_task"; titleTemplate?: string; dueInDays?: number }
  | { type: "send_webhook"; integrationId: string };

export const automationRulesTable = pgTable(
  "automation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    name: text("name").notNull(),
    triggerType: text("trigger_type").notNull().default("call_analyzed"),
    conditions: jsonb("conditions").$type<RuleCondition>().notNull().default({}),
    actions: jsonb("actions").$type<RuleAction[]>().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("automation_rules_user_idx").on(t.userId),
  }),
);

export const insertAutomationRuleSchema = createInsertSchema(
  automationRulesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type AutomationRule = typeof automationRulesTable.$inferSelect;
