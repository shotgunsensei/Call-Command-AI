/**
 * Productization modes — pre-baked starter configurations for common call
 * orchestration use-cases. Each mode declares default channels, automation
 * rule seeds, and dashboard labels. Applied IDEMPOTENTLY by the setup
 * wizard: a slot is only seeded if the user has zero of that resource.
 *
 * IMPORTANT: This is administrative routing only. The Medical mode
 * intentionally avoids any clinical/diagnostic claims — its actions are
 * scheduling and intake routing, never medical advice.
 */

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
}

export interface RuleSeed {
  name: string;
  conditions: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
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
      },
      {
        name: "Emergency Line",
        greetingText:
          "You have reached the emergency response line. Please clearly state the nature of the outage.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
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
  },
  field_service: {
    id: "field_service",
    label: "Field Service",
    description:
      "Dispatch-driven inbound for field service teams. Default dispatch and after-hours lines with job creation and dispatcher notifications.",
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
      },
      {
        name: "After Hours Line",
        greetingText:
          "You've reached our after-hours line. Please describe your urgent request and a callback number.",
        recordingConsentText: STD_CONSENT,
        afterHoursBehavior: "voicemail",
        recordCalls: true,
        allowVoicemail: true,
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
  },
  medical: {
    id: "medical",
    label: "Medical / Office Intake",
    description:
      "Administrative intake for medical and dental offices. Scheduling and general questions only — never makes diagnostic claims, never offers medical advice.",
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
  },
  general: {
    id: "general",
    label: "General Business",
    description:
      "A neutral starter for any inbound call workflow. One default line, no specialized rules.",
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
      },
    ],
    rules: [],
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
