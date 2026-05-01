# Overview

CallCommand AI is a production application designed to transform phone call recordings into structured intelligence. It acts as an end-to-end business automation platform, integrating audio processing, AI-powered analysis, and customizable automation workflows. The platform aims to provide actionable insights from customer interactions, helping businesses manage leads, tickets, tasks, and automate follow-up processes.

Key capabilities include:
- Processing and transcribing phone call audio (uploads + live Twilio inbound).
- Analyzing call content to extract intent, sentiment, and key information.
- Automating business workflows based on call analysis, such as creating support tickets, sales leads, or tasks.
- Integrating with external services via webhooks and other mechanisms.
- Supporting multi-line call orchestration with per-channel flow definitions and channel-aware TwiML.
- Providing a dashboard for analytics and operational insights, plus a polled Switchboard view for live operations.

# Phase 3 — Production-Readiness Hardening (current)

This pass closes the gaps surfaced in the Phase 3 review and makes the
live-call layer safe to put in front of real callers.

- **Channel persistence + ownership.**
  `POST/PATCH /api/channels` now persists, validates, and round-trips
  every Phase 3 field — `liveBehavior`, `receptionistProfileId`,
  `requireRecordingConsent`, `consentScript`,
  `consentRequiredBeforeRecording`. Invalid `liveBehavior`/
  `afterHoursBehavior` values return 400. `receptionistProfileId` is
  ownership-checked against `receptionist_profiles.user_id` so one
  workspace cannot bind a channel to another workspace's profile.
- **Global phone uniqueness.** `POST/PATCH /api/channels` rejects a
  `phoneNumber` already used by a different channel (any workspace) with
  HTTP 409 — Twilio numbers can only legitimately route to one workspace
  at a time.
- **Business-hours enforcement.** New helper
  `lib/businessHours.ts` evaluates `channels.business_hours` (timezone
  aware, supports overnight 22:00→06:00 ranges, safe defaults). The
  Twilio incoming dispatcher branches on
  `channels.after_hours_behavior` outside the configured window:
  `voicemail` (gated on `allowVoicemail`), `forward` (degrades to
  voicemail/hangup if `forwardNumber` missing),
  `ai_intake_placeholder` (loads the receptionist profile and runs the
  AI flow), or `hangup`. The opposite-side `liveBehavior =
  ai_after_hours_intake` only engages the AI receptionist when the call
  lands after hours.
- **Recording-consent gating.** When
  `requireRecordingConsent && consentRequiredBeforeRecording`, the
  Twilio `/voice/incoming` handler responds with a DTMF Gather playing
  `consentScript`. New endpoint `POST /api/twilio/voice/consent`:
  signature-validated, decodes Digits, writes a per-call
  `telephony_events` row (`consent:accepted | declined | no_response |
  invalid` keyed on `consent:{callSid}:{outcome}`), then either
  re-enters the main flow with `consentVerified=true`, hangs up with an
  explanation, or re-prompts.
- **Caller phone preservation.**
  `services/callPipeline.ts` now uses `COALESCE(call_records.caller_phone,
  ${analysisGuess})` so the provider-supplied `From` is never clobbered
  by the AI analysis service's best guess.
- **Real switchboard transfer.** New `services/twilioControl.ts`
  redirects a live call via Twilio's `Calls/{Sid}` REST update
  (`Twiml=` inline). `POST /api/live-sessions/:id/transfer` calls it
  and writes a `transfer_logs` row whose `status` is the coarse audit
  value (`bridged | failed`) and whose `reason` carries the rich
  outcome (`[redirected | logged_no_provider | no_call_sid |
  no_target_phone | failed] <message>`). HTTP responses are honest:
  202 when we logged the intent but no live redirect happened (Twilio
  unconfigured, non-Twilio session, missing target phone), 502 on
  upstream Twilio failures, 200 on real bridge.
- **Smoke checks.** `scripts/smoke-phase3-hardening.sh` exercises
  `/api/healthz`, signature rejection on `/voice/incoming` and
  `/voice/consent`, auth required on `/channels` and
  `/live-sessions/:id/transfer`, and pure-helper sanity (business
  hours including overnight + malformed input, E.164 normalization).
  `pnpm run typecheck` is green.

# Phase 3 — Live AI Receptionist + Transfer Logic

Phase 3 builds the live, real-time voice layer on top of Phase 2:

- **New tables.** `receptionist_profiles` (greeting / fallback /
  escalation / voicemail scripts + intake schema + escalation rules),
  `live_call_sessions` (per-call live state — current step, collected
  data, transcript_live, ai_summary_live, internal notes, created
  object ids, isDemo), `transfer_targets`, `transfer_logs`. Channels
  gain `live_behavior`, `receptionist_profile_id`,
  `require_recording_consent`, `consent_script`, and
  `consent_required_before_recording`.
- **Multi-turn Twilio Gather.** `POST /api/twilio/voice/incoming`
  branches on `channel.live_behavior`. AI behaviors create a
  `live_call_sessions` row and respond with `<Gather input="speech">`.
  `POST /api/twilio/voice/gather` is signature-validated, idempotent
  via `telephony_events.providerEventId`, runs the intake engine +
  escalation evaluator + AI decision service, and returns the next
  TwiML (next question / `<Dial>` to a transfer target / `<Record>`
  voicemail / polite hang-up).
- **Intake engine + escalation evaluator** (`lib/intakeEngine.ts`,
  `lib/escalation.ts`) — pure functions, no I/O, fully unit-testable.
- **AI decision service** (`services/liveReceptionist.ts`) — strict
  JSON output via OpenAI `gpt-5.4` (`response_format: json_object`)
  with zod validation; deterministic demo fallback when no key.
  Server-side only — never throws into the webhook handler.
- **CRUD APIs.** `/api/receptionist-profiles`, `/api/transfer-targets`,
  `/api/live-sessions` with `mark-urgent`, `transfer`, `end`,
  `add-note` actions. All scoped by `userId`.
- **Switchboard extension.** `GET /api/switchboard` now returns a
  `liveSessions[]` array. The UI polls every 4s and shows live AI
  sessions on top with quick actions.
- **Live-call simulator.** `POST /api/simulate/live-call/{start, :id/say,
  :id/end}` for testing without real Twilio minutes. Sessions are
  flagged `is_demo = "true"`.
- **Product modes seed receptionist profiles + transfer targets** in
  addition to channels/flows. Idempotent. Medical mode is strictly
  administrative — no diagnosis. No automotive diagnostics.
- **Recording-consent UX.** Channels can require a consent script
  before greeting and gate recording on acknowledgement.
- **Frontend.** New pages `/receptionist-profiles`,
  `/transfer-targets`, `/simulate/live-call`. Channels page exposes a
  "Live AI receptionist" accordion. Switchboard shows live sessions
  with quick actions.

# Phase 2 — Production telephony

Phase 2 adds first-class inbound telephony on top of the Phase 1 foundation. Highlights:

- **Provider abstraction** under `artifacts/api-server/src/services/telephony/` with a working Twilio implementation and SIP / Asterisk / FreePBX scaffolding (stubs throw on `validateRequest`).
- **Twilio webhooks** at `/api/twilio/voice/{incoming,status,recording,transcription}`. Signature-validated, no Clerk auth, urlencoded-aware. Recording webhook is idempotent via a `recordings_call_sid_unique` index.
- **Channel extensions** (`channels` table): `greetingText`, `recordCalls`, `allowVoicemail`, `businessHours` (jsonb), `afterHoursBehavior`, `forwardNumber`, `maxCallDurationSeconds`, `recordingConsentText`, `assignedFlowId`, `productMode`. All of these flow into TwiML.
- **Call record extensions** (`call_records` table): `provider`, `providerCallSid` (indexed), `calledNumber`, `callDirection`, `recordingUrl`, `recordingSid` (unique), `recordingDurationSeconds`. New status values (`incoming`, `ringing`, `in_progress`, `recording_ready`, `transcribing`, `analyzing`, `flow_running`, `completed`, `failed`, `busy`, `no_answer`) live alongside the old ones; the UI collapses them via a shared `lib/callStatus.ts` mapper into `pending / ready / error` buckets.
- **`telephony_events` table** storing every provider event (raw payload jsonb, scoped to user). Surfaced on the Call Detail page as a polled timeline.
- **Phone-number normalization** (`lib/phoneNumbers.ts`) applied on channel insert/update + on lookup. Inbound `To` is matched to a channel by E.164.
- **Switchboard view** (`/switchboard`, polled every 7s) showing every channel with its last-24h calls.
- **Productization modes** (`lib/productModes.ts`): MSP, Sales, Field Service, Medical (administrative intake only — never diagnostic), General. Each seeds default channels, flows, and rules.
- **Setup wizard** (`/setup/telephony`) — pick a mode, wire Twilio, verify.
- **Retry processing** endpoint (`POST /api/calls/:id/retry-processing`) re-downloads the Twilio recording with auth and re-runs the AI pipeline.

See `artifacts/callcommand/README.md` for the operator-facing docs (env vars, Twilio webhook setup, recording-consent disclosure, troubleshooting).

The project's vision is to enhance business efficiency by converting raw call data into organized, actionable intelligence, enabling better customer relationship management and operational automation.

# User Preferences

I prefer iterative development with a focus on high-quality code. Please ask before making major architectural changes or introducing new dependencies. I value clear, concise explanations and prefer to see concrete examples for new features or complex implementations. I expect the agent to adhere to the established monorepo structure and follow TypeScript best practices.

# System Architecture

The project is a pnpm workspace monorepo built with Node.js 24 and TypeScript 5.9.

**Core Technologies:**
- **Backend Framework:** Express 5 for API services.
- **Database:** PostgreSQL with Drizzle ORM for schema management and data interaction.
- **Validation:** Zod for schema validation, integrated with Drizzle for type safety.
- **API Definition:** OpenAPI specification with Orval for client and Zod schema generation.
- **Build Tool:** esbuild for CJS bundle creation.

**Monorepo Structure & Packages:**
- `artifacts/api-server`: Express 5 API. Integrates Clerk for authentication, OpenAI for AI processing, and Google Cloud Storage (GCS) for object storage. Provides endpoints for health checks, user data, call management, action items, integrations, stats, and billing.
- `artifacts/callcommand`: React + Vite frontend. Utilizes Clerk for authentication and `@workspace/api-client-react` for API interaction. Implements a dark mode UI.
- `artifacts/api-spec`: Defines the OpenAPI specification.
- `artifacts/db`: Contains database schema definitions and migration tools.
- `artifacts/scripts`: Houses utility scripts for various operations, including database schema normalization and hardening tests.

**Authentication:**
- Clerk (Replit-managed) for user authentication and authorization. It includes proxy integration and `clerkMiddleware` with user auto-upsertion.

**AI Integration:**
- OpenAI via Replit AI Integrations for audio transcription (`gpt-4o-mini-transcribe`) and call analysis (`gpt-5.4` in JSON mode). A fallback demo transcript and analysis are provided if API keys are absent or transcription is too short.

**Object Storage:**
- Direct uploads to GCS via presigned URLs for audio files, with paths stored in `call_records.fileUrl`. Secure download requiring Clerk auth and ownership verification.
- `upload_intents` table manages pending, uploaded, and attached states for file uploads, ensuring atomic claims within database transactions.

**PDF Generation:**
- `pdfkit` is used to generate red-accented reports on demand.

**Billing & Plans:**
- `lib/plans.ts` defines subscription plans (free, pro, business, msp) with monthly call limits enforced on `POST /api/calls`.
- Stripe integration is present as a placeholder, with `/api/billing/checkout` returning `configured:false` if `STRIPE_SECRET_KEY` is missing.

**UI/UX:**
- React + Vite frontend with dark mode by default.
- ClerkProvider is configured for routing and appearance.
- CRUD UIs for automation rules, tickets, leads, tasks, and channels.
- Dashboard widgets provide a comprehensive overview of system statistics, including open tickets, new leads, open tasks, sentiment alerts, and conversion funnels.
- A "Simulate inbound call" feature for testing ingestion pipelines.
- Call detail page includes a "Flow Execution Trace" card.

**Business Automation Platform:**
- **Ownership Model:** Resources are owned directly by the Clerk `userId`, currently supporting a single-user workspace.
- **Rules Engine:** `services/rulesEngine.ts` evaluates `automation_rules` against analyzed calls, dispatching actions based on conditions. Default rules are seeded for support, sales, and scheduling.
- **Action Engine:** `services/actions.ts` implements actions such as `create_ticket`, `create_lead`, `create_task`, `send_webhook`, `send_slack`, `send_email`, `assign_user`, and `mark_priority`.
- **Ingestion Endpoints:** `/api/ingest/*` endpoints for Twilio, email, and generic webhooks, authenticated via a per-user ingestion token. These create call records, trigger analysis, and run rules. A demo endpoint `/api/demo/simulate-call` is also available.
- **Multi-line Call Orchestration (Channels & Flows):**
    - `channels` table manages inbound phone lines/channels with type, phone number, and default route.
    - `call_flows` defines configurable call flows, optionally bound to channels.
    - `flow_nodes` represents steps within a flow (condition, action, AI decision, route).
    - `flow_logs` provides a chronological trace of flow execution for debugging.
    - The `flowEngine` executes flows, processing nodes and logging steps, with a loop guard of 50 steps.

**Database Schema Highlights:**
- `users`: Clerk userId, email, name, avatarUrl, plan, Stripe integration details.
- `call_records`: userId, fileUrl, transcriptText, summary, customer details, AI analysis (intent, priority, sentiment), status, keyPoints, followUpMessage, crmJson, suggestedTags, `isDemo`, errorMessage. Includes `channel_id` and `assigned_user_id`.
- `action_items`: callRecordId, title, description, dueDate, priority, status.
- `integrations`: userId, type (crm, zapier, webhook, slack), name, webhookUrl, enabled.
- `upload_intents`: id, userId, object_path, original_filename, mime_type, max_size_bytes, status (pending, uploaded, attached, expired), created_at, expires_at.
- `automation_rules`: userId, JSONB conditions, JSONB actions, `is_default`.
- `tickets`, `leads`, `tasks`: userId, linkedCallId, and specific fields for each entity, including `assigned_user_id`.
- `followup_logs`: userId, callRecordId, channel, recipient, subject, message, status.
- `ingestion_events`: userId, reference to `call_record_id`, raw payload.
- `channels`: userId, name, phoneNumber, type, defaultRoute, isActive, isDefault.
- `call_flows`: userId, name, description, channelId, startNodeId, isActive.
- `flow_nodes`: flowId, type, label, JSONB config, nextNodeId, nextNodeIdFalse, orderIndex.
- `flow_logs`: userId, callRecordId, flowId, nodeId, nodeType, nodeLabel, branch, ok, message, JSONB detail, stepIndex.

# External Dependencies

- **pnpm workspaces**: Monorepo management.
- **Node.js**: Runtime environment (v24).
- **TypeScript**: Language (v5.9).
- **Express**: Web application framework (v5).
- **PostgreSQL**: Relational database.
- **Drizzle ORM**: TypeScript ORM for PostgreSQL.
- **Zod**: Schema declaration and validation library (`zod/v4`).
- **drizzle-zod**: Zod schemas from Drizzle.
- **Orval**: OpenAPI client code generation.
- **esbuild**: JavaScript bundler.
- **Clerk**: Authentication and user management.
- **OpenAI**: AI services for transcription and analysis (via Replit AI Integrations).
- **Google Cloud Storage (GCS)**: Object storage for audio files.
- **pdfkit**: PDF document generation.
- **Stripe**: Payment processing (placeholder integration).
- **Twilio**: Inbound call recording webhooks (for `/api/ingest/twilio`).
- **Slack**: Integration for sending notifications (`send_slack` action).