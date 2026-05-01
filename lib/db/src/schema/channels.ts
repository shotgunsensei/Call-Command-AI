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

/**
 * Free-form business hours JSON. We accept either a "always" sentinel or a
 * day-keyed map of {start, end} 24h strings. The orchestrator side does the
 * actual schedule check so this stays loose for forward-compat.
 */
export interface BusinessHours {
  mode?: "always" | "weekly";
  timezone?: string;
  weekly?: Partial<
    Record<
      "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
      { start: string; end: string } | null
    >
  >;
}

export type AfterHoursBehavior =
  | "voicemail"
  | "forward"
  | "ai_intake_placeholder"
  | "hangup";

/**
 * High-level live-call behavior for inbound provider calls. The Twilio
 * incoming handler branches on this to decide whether to record-only,
 * forward, take voicemail, or hand off to the AI receptionist.
 */
export type ChannelLiveBehavior =
  | "record_only"
  | "forward_only"
  | "voicemail_only"
  | "ai_receptionist"
  | "ai_screen_then_transfer"
  | "ai_after_hours_intake";

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
    // Phase 2 — channel-aware TwiML behavior
    greetingText: text("greeting_text"),
    recordCalls: boolean("record_calls").notNull().default(true),
    allowVoicemail: boolean("allow_voicemail").notNull().default(true),
    businessHours: jsonb("business_hours").$type<BusinessHours>(),
    afterHoursBehavior: text("after_hours_behavior")
      .$type<AfterHoursBehavior>()
      .notNull()
      .default("voicemail"),
    forwardNumber: text("forward_number"),
    maxCallDurationSeconds: integer("max_call_duration_seconds"),
    recordingConsentText: text("recording_consent_text"),
    assignedFlowId: uuid("assigned_flow_id"),
    productMode: text("product_mode"),
    // Phase 3 — live AI receptionist
    liveBehavior: text("live_behavior")
      .$type<ChannelLiveBehavior>()
      .notNull()
      .default("record_only"),
    receptionistProfileId: uuid("receptionist_profile_id"),
    requireRecordingConsent: boolean("require_recording_consent")
      .notNull()
      .default(false),
    consentScript: text("consent_script"),
    consentRequiredBeforeRecording: boolean("consent_required_before_recording")
      .notNull()
      .default(false),
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
