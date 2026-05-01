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

export const channelsTable = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    name: text("name").notNull(),
    phoneNumber: text("phone_number"),
    type: text("type").notNull().default("webhook"),
    defaultRoute: text("default_route"),
    isActive: boolean("is_active").notNull().default(true),
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
    userIdx: index("channels_user_idx").on(t.userId),
    phoneIdx: index("channels_phone_idx").on(t.userId, t.phoneNumber),
  }),
);

export const insertChannelSchema = createInsertSchema(channelsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Channel = typeof channelsTable.$inferSelect;
