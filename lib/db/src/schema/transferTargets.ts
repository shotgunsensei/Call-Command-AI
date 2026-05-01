import {
  boolean,
  index,
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
import type { BusinessHours } from "./channels";

export type TransferTargetType =
  | "user"
  | "queue"
  | "external_number"
  | "voicemail";

export const transferTargetsTable = pgTable(
  "transfer_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Owner workspace. */
    userId: varchar("user_id", { length: 64 }).notNull(),
    name: text("name").notNull(),
    type: text("type").$type<TransferTargetType>().notNull(),
    phoneNumber: text("phone_number"),
    /** When type = "user", the Clerk userId of the human to ring. */
    targetUserId: varchar("target_user_id", { length: 64 }),
    queueName: text("queue_name"),
    businessHours: jsonb("business_hours").$type<BusinessHours>(),
    /** Lower number = preferred. Lets escalation pick the highest-priority on-call. */
    priority: integer("priority").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    productMode: text("product_mode"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("transfer_targets_user_idx").on(t.userId),
  }),
);

export const insertTransferTargetSchema = createInsertSchema(
  transferTargetsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTransferTarget = z.infer<typeof insertTransferTargetSchema>;
export type TransferTarget = typeof transferTargetsTable.$inferSelect;
