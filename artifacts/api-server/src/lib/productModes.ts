/**
 * Productization modes — pre-baked starter configurations for common call
 * orchestration use-cases. Each mode declares default channels, automation
 * rule seeds, dashboard labels, AI receptionist profiles, and transfer
 * targets. Applied IDEMPOTENTLY by the setup wizard: a slot is only
 * seeded if the user has zero of that resource type.
 *
 * IMPORTANT: This is administrative routing only. The Medical mode
 * intentionally avoids any clinical/diagnostic claims — its actions are
 * scheduling and intake routing, never medical advice. Field service has
 * NO automotive diagnostic claims either.
 */

import type { ChannelLiveBehavior, IntakeSchema, EscalationRules } from "@workspace/db";

export type ProductModeId =
  | "msp"
  | "sales"
  | "field_service"
  | "medical"
  | "general";

export interface ChannelSeed {
  name: string;
  greetingText: string;
  recordingConsentText: string;
  afterHoursBehavior: "voicemail" | "forward" | "ai_intake_placeholder" | "hangup";
  recordCalls: boolean;
  allowVoicemail: boolean;
  isDefault?: boolean;
  liveBehavior?: ChannelLiveBehavior;
  /** Name of a receptionist seed in `receptionistProfiles` to bind. */
  receptionistProfileName?: string;
  requireRecordingConsent?: boolean;
  consentScript?: string;
  consentRequiredBeforeRecording?: boolean;
}

export interface RuleSeed {
  name: string;
  conditions: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
}

export interface ReceptionistProfileSeed {
  name: string;
  greetingScript: string;
  fallbackScript?: string;
  escalationScript?: string;
  voicemailScript?: string;
  tone: "professional" | "friendly" | "urgent" | "concise" | "warm";
  intakeSchema: IntakeSchema;
  escalationRules: EscalationRules;
  isDefault?: boolean;
}

export interface TransferTargetSeed {
  name: string;
  type: "user" | "queue" | "external_number" | "voicemail";
  phoneNumber?: string | null;
  queueName?: string | null;
  priority?: number;
}

export interface ProductMode {
  id: ProductModeId;
  label: string;
  description: string;
  dashboardLabels: {
    primaryArtifact: string;
    secondaryArtifact: string;
  };
  channels: ChannelSeed[];
  rules: RuleSeed[];
  receptionistProfiles: ReceptionistProfileSeed[];
  transferTargets: TransferTargetSeed[];
}

const STD_CONSENT =
  "This call may be recorded for quality and training purposes.";

export const PRODUCT_MODES: Record<ProductModeId, ProductMode> = {
  msp: {
    id: "msp",
    label: "MSP Support Desk",
    description:
      "Ticket-driven inbound for managed-service providers. Default lines for support, emergencies, billing, and sales with auto-ticketing and urgent escalation.",
    dashboardLabels: {
      primaryArtifact: "Tickets",
      secondaryArtifact: "Escalations",
    },
    channels: [
      {
        name: "Support Line",
        greetingText:
          "Thank you for calling support. Please describe your issue after the tone.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
        isDefault: true,
        liveBehavior: "ai_receptionist",
        receptionistProfileName: "MSP Support Receptionist",
      },
      {
        name: "Emergency Line",
        greetingText:
          "You have reached the emergency response line. Please clearly state the nature of the outage.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
        liveBehavior: "ai_screen_then_transfer",
        receptionistProfileName: "MSP Support Receptionist",
      },
      {
        name: "Billing Line",
        greetingText:
          "You have reached billing. Please leave your account number and your question.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
      },
      {
        name: "Sales Line",
        greetingText:
          "Thanks for calling sales. Please leave your name, company, and what you're evaluating.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
      },
    ],
    rules: [
      {
        name: "Auto-create ticket for support calls",
        conditions: { callType: "support" },
        actions: [{ type: "create_ticket", titleTemplate: "Support: {{summary}}" }],
      },
      {
        name: "Escalate urgent priority",
        conditions: { priority: "urgent" },
        actions: [{ type: "create_task", titleTemplate: "URGENT escalate: {{customerName}}" }],
      },
    ],
    receptionistProfiles: [
      {
        name: "MSP Support Receptionist",
        greetingScript:
          "Thank you for calling support. I'm a virtual receptionist and I can help route your call.",
        fallbackScript:
          "I'm having trouble hearing you. We'll follow up by email. Goodbye.",
        escalationScript:
          "This sounds urgent. I'm connecting you to our on-call engineer right now.",
        voicemailScript:
          "Please leave your name, company, and a brief description of the issue after the tone.",
        tone: "professional",
        intakeSchema: {
          fields: [
            { key: "caller_name", label: "your name", required: true },
            { key: "company", label: "company name", required: true },
            { key: "issue_summary", label: "issue you're calling about", required: true },
            {
              key: "urgency",
              label: "urgency",
              required: true,
              allowedValues: ["normal", "high", "emergency"],
              prompt:
                "How urgent is this? Please say one of: normal, high, or emergency.",
            },
          ],
        },
        escalationRules: {
          emergencyKeywords: [
            "outage",
            "down",
            "ransomware",
            "breach",
            "no internet",
            "completely down",
          ],
          angrySentimentEscalates: true,
        },
        isDefault: true,
      },
    ],
    transferTargets: [
      {
        name: "On-call Engineer",
        type: "queue",
        queueName: "msp-oncall",
        priority: 10,
      },
      {
        name: "Billing Team",
        type: "queue",
        queueName: "msp-billing",
        priority: 50,
      },
    ],
  },
  sales: {
    id: "sales",
    label: "Sales Intake",
    description:
      "Lead-driven inbound for sales teams. Default lines for new leads vs. existing customers, with auto lead-creation and follow-up tasks.",
    dashboardLabels: {
      primaryArtifact: "Leads",
      secondaryArtifact: "Follow-ups",
    },
    channels: [
      {
        name: "New Leads Line",
        greetingText:
          "Thanks for reaching out. Please leave your name, company, and what you're looking for.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
        isDefault: true,
        liveBehavior: "ai_receptionist",
        receptionistProfileName: "Sales Intake Receptionist",
      },
      {
        name: "Existing Customers Line",
        greetingText:
          "Thanks for calling. Please leave your account name and how we can help.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
      },
    ],
    rules: [
      {
        name: "Create lead for sales inquiries",
        conditions: { callType: "inquiry" },
        actions: [{ type: "create_lead" }],
      },
      {
        name: "Schedule follow-up for sales calls",
        conditions: { callType: "sales" },
        actions: [
          {
            type: "create_task",
            titleTemplate: "Follow up: {{customerName}}",
            dueInDays: 1,
          },
        ],
      },
    ],
    receptionistProfiles: [
      {
        name: "Sales Intake Receptionist",
        greetingScript:
          "Thanks for calling sales. I'm a virtual receptionist and can take a few details so the right rep can follow up.",
        fallbackScript:
          "Sorry, I missed that. We'll reach out by email. Goodbye.",
        voicemailScript:
          "Please leave your name, company, contact info, and what you're evaluating.",
        tone: "friendly",
        intakeSchema: {
          fields: [
            { key: "caller_name", label: "your name", required: true },
            { key: "company", label: "company name", required: true },
            { key: "callback_number", label: "best callback number", required: true },
            { key: "interest", label: "what you're evaluating", required: true },
            {
              key: "timeline",
              label: "timeline",
              required: false,
              allowedValues: ["this week", "this month", "this quarter", "exploring"],
            },
          ],
        },
        escalationRules: {
          angrySentimentEscalates: false,
        },
        isDefault: true,
      },
    ],
    transferTargets: [
      {
        name: "Sales Round-Robin",
        type: "queue",
        queueName: "sales-rr",
        priority: 10,
      },
    ],
  },
  field_service: {
    id: "field_service",
    label: "Field Service",
    description:
      "Dispatch-driven inbound for field service teams (plumbing, HVAC, electrical, locksmiths). Default dispatch and after-hours lines with job creation and dispatcher notifications. NOTE: never makes automotive diagnostic claims — diagnosis is the technician's job.",
    dashboardLabels: {
      primaryArtifact: "Jobs",
      secondaryArtifact: "Dispatch",
    },
    channels: [
      {
        name: "Dispatch Line",
        greetingText:
          "Thank you for calling dispatch. Please describe the issue and your service address.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
        isDefault: true,
        liveBehavior: "ai_receptionist",
        receptionistProfileName: "Field Service Dispatcher",
      },
      {
        name: "After Hours Line",
        greetingText:
          "You've reached our after-hours line. Please describe your urgent request and a callback number.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
        liveBehavior: "ai_after_hours_intake",
        receptionistProfileName: "Field Service Dispatcher",
      },
    ],
    rules: [
      {
        name: "Create job task from dispatch call",
        conditions: { callType: "support" },
        actions: [{ type: "create_task", titleTemplate: "Job: {{summary}}" }],
      },
      {
        name: "Urgent dispatch fast-path",
        conditions: { priority: "urgent" },
        actions: [
          { type: "create_task", titleTemplate: "DISPATCH NOW: {{customerName}}" },
        ],
      },
    ],
    receptionistProfiles: [
      {
        name: "Field Service Dispatcher",
        greetingScript:
          "Thank you for calling. I'm a virtual dispatcher and can take your details so a technician can be scheduled. I won't diagnose the issue over the phone — our technician will assess on site.",
        fallbackScript:
          "Sorry, I missed that. A dispatcher will follow up. Goodbye.",
        voicemailScript:
          "Please leave your name, service address, callback number, and a brief description of the issue.",
        tone: "professional",
        intakeSchema: {
          fields: [
            { key: "caller_name", label: "your name", required: true },
            { key: "callback_number", label: "best callback number", required: true },
            { key: "service_address", label: "service address", required: true },
            { key: "issue_summary", label: "issue you're seeing", required: true },
            {
              key: "urgency",
              label: "urgency",
              required: true,
              allowedValues: ["routine", "same-day", "emergency"],
            },
          ],
        },
        escalationRules: {
          emergencyKeywords: [
            "no heat",
            "flooding",
            "gas leak",
            "no power",
            "smoke",
          ],
          angrySentimentEscalates: false,
        },
        isDefault: true,
      },
    ],
    transferTargets: [
      {
        name: "On-call Dispatcher",
        type: "queue",
        queueName: "field-oncall",
        priority: 10,
      },
    ],
  },
  medical: {
    id: "medical",
    label: "Medical / Office Intake",
    description:
      "Administrative intake for medical and dental offices. Scheduling and general questions only — never makes diagnostic claims, never offers medical advice or triage.",
    dashboardLabels: {
      primaryArtifact: "Intake Tasks",
      secondaryArtifact: "Scheduling",
    },
    channels: [
      {
        name: "Scheduling Line",
        greetingText:
          "Thank you for calling. Please leave your name and the appointment you'd like to schedule. Our staff will return your call.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
        isDefault: true,
        liveBehavior: "ai_receptionist",
        receptionistProfileName: "Office Scheduling Receptionist",
        requireRecordingConsent: true,
        consentScript:
          "This call may be recorded for quality and training purposes. By staying on the line you consent.",
      },
      {
        name: "General Questions Line",
        greetingText:
          "Thank you for calling. For non-clinical questions, please leave a message and our staff will return your call.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
      },
    ],
    rules: [
      {
        name: "Flag urgent intake calls",
        conditions: { priority: "urgent" },
        actions: [
          { type: "create_task", titleTemplate: "URGENT intake: {{customerName}}" },
        ],
      },
      {
        name: "Create intake task for inquiries",
        conditions: { callType: "inquiry" },
        actions: [
          { type: "create_task", titleTemplate: "Intake: {{customerName}}" },
        ],
      },
    ],
    receptionistProfiles: [
      {
        name: "Office Scheduling Receptionist",
        greetingScript:
          "Thank you for calling. I'm a virtual receptionist for our office. I can collect your contact information and the reason for your call so our staff can return it. I cannot give medical advice or discuss clinical matters.",
        fallbackScript:
          "Sorry, I missed that. Our staff will return your call. Goodbye.",
        voicemailScript:
          "Please leave your name, callback number, and the reason for your call.",
        tone: "warm",
        intakeSchema: {
          fields: [
            { key: "caller_name", label: "your name", required: true },
            { key: "callback_number", label: "best callback number", required: true },
            {
              key: "request_type",
              label: "type of request",
              required: true,
              allowedValues: [
                "schedule appointment",
                "reschedule appointment",
                "billing question",
                "general question",
              ],
            },
            { key: "preferred_callback_time", label: "preferred callback time", required: false },
          ],
        },
        escalationRules: {
          // Intentionally empty: medical mode never auto-escalates on
          // keywords. Anything urgent is handled by staff, not the bot.
        },
        isDefault: true,
      },
    ],
    transferTargets: [
      {
        name: "Front Desk",
        type: "queue",
        queueName: "front-desk",
        priority: 10,
      },
    ],
  },
  general: {
    id: "general",
    label: "General Business",
    description:
      "A neutral starter for any inbound call workflow. One default line, optional AI receptionist.",
    dashboardLabels: {
      primaryArtifact: "Calls",
      secondaryArtifact: "Tasks",
    },
    channels: [
      {
        name: "Main Line",
        greetingText:
          "Thank you for calling. Please leave your message and we will return your call.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
        isDefault: true,
        liveBehavior: "record_only",
      },
    ],
    rules: [],
    receptionistProfiles: [
      {
        name: "General Receptionist",
        greetingScript:
          "Thank you for calling. I'm a virtual receptionist and can take a message for you.",
        fallbackScript: "Sorry, I missed that. We'll follow up. Goodbye.",
        voicemailScript:
          "Please leave your name, callback number, and message after the tone.",
        tone: "professional",
        intakeSchema: {
          fields: [
            { key: "caller_name", label: "your name", required: true },
            { key: "callback_number", label: "best callback number", required: true },
            { key: "reason", label: "reason for your call", required: true },
          ],
        },
        escalationRules: {},
        isDefault: true,
      },
    ],
    transferTargets: [],
  },
};

export function listProductModes(): ProductMode[] {
  return Object.values(PRODUCT_MODES);
}

export function getProductMode(id: string): ProductMode | null {
  if (id in PRODUCT_MODES) {
    return PRODUCT_MODES[id as ProductModeId];
  }
  return null;
}
