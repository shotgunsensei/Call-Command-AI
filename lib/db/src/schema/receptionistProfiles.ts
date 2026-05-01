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

/**
 * Definition of a single intake field the receptionist will try to collect
 * from the caller. Kept structural / loose so product modes can extend it
 * without schema changes.
 */
export interface IntakeField {
  key: string;
  label: string;
  required?: boolean;
  allowedValues?: string[];
  /**
   * Optional natural-language prompt the AI/Twilio Gather should use to ask
   * for this field. Falls back to a sensible default built from `label`.
   */
  prompt?: string;
}

export interface IntakeSchema {
  fields: IntakeField[];
}

/**
 * Per-profile escalation configuration. Loose by design: every key is
 * optional so future modes can add new triggers without a migration.
 */
export interface EscalationRules {
  /** Lower-cased substrings that, if present in caller speech, escalate. */
  emergencyKeywords?: string[];
  angrySentimentEscalates?: boolean;
  /** E.164 caller numbers that always escalate. */
  vipNumbers?: string[];
  /** Optional transfer target to use when emergency triggers after-hours. */
  afterHoursEmergencyTransferTargetId?: string | null;
}

export type ReceptionistVoiceProvider =
  | "twilio"
  | "elevenlabs_placeholder"
  | "openai_realtime_placeholder";

export type ReceptionistTone =
  | "professional"
  | "friendly"
  | "urgent"
  | "concise"
  | "warm";

export const receptionistProfilesTable = pgTable(
  "receptionist_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    /** Optional: restrict this profile to a specific channel. NULL = workspace-wide. */
    channelId: uuid("channel_id"),
    name: text("name").notNull(),
    voiceProvider: text("voice_provider")
      .$type<ReceptionistVoiceProvider>()
      .notNull()
      .default("twilio"),
    greetingScript: text("greeting_script").notNull(),
    fallbackScript: text("fallback_script"),
    escalationScript: text("escalation_script"),
    voicemailScript: text("voicemail_script"),
    tone: text("tone").$type<ReceptionistTone>().notNull().default("professional"),
    intakeSchema: jsonb("intake_schema").$type<IntakeSchema>().notNull().default({ fields: [] }),
    escalationRules: jsonb("escalation_rules")
      .$type<EscalationRules>()
      .notNull()
      .default({}),
    enabled: boolean("enabled").notNull().default(true),
    /** First profile the user created (or via setup wizard) becomes the default. */
    isDefault: boolean("is_default").notNull().default(false),
    /** Audit trail for which product mode seeded this profile, if any. */
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
    userIdx: index("receptionist_profiles_user_idx").on(t.userId),
    userChannelIdx: index("receptionist_profiles_channel_idx").on(
      t.userId,
      t.channelId,
    ),
  }),
);

export const insertReceptionistProfileSchema = createInsertSchema(
  receptionistProfilesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReceptionistProfile = z.infer<
  typeof insertReceptionistProfileSchema
>;
export type ReceptionistProfile = typeof receptionistProfilesTable.$inferSelect;
