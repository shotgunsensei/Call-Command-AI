import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable(
  "users",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    plan: text("plan").notNull().default("free"),
    // Role-based access. "admin" bypasses plan limits and gates the
    // workspace-admin UI surface. Default "user" for everyone else.
    // Synced from ADMIN_EMAILS env on every requireAuth pass.
    role: text("role").notNull().default("user"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    ingestionTokenHash: text("ingestion_token_hash"),
    // Phase 2 — productization mode picked in /setup/telephony wizard.
    // Drives default channel/flow/rule seeding. Nullable until the
    // workspace is set up.
    productMode: text("product_mode"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    ingestionTokenHashIdx: uniqueIndex("users_ingestion_token_hash_idx").on(
      table.ingestionTokenHash,
    ),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
