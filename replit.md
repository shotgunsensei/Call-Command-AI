# Overview

CallCommand AI is an end-to-end business automation platform designed to transform phone call recordings into structured intelligence. It processes, transcribes, and analyzes call content using AI to extract intent, sentiment, and key information. The platform automates business workflows, such as creating support tickets, sales leads, or tasks, and integrates with external services. It supports multi-line call orchestration and provides a dashboard for analytics and a real-time Switchboard for live operations. The vision is to enhance business efficiency by converting raw call data into organized, actionable intelligence, improving customer relationship management and operational automation.

# User Preferences

I prefer iterative development with a focus on high-quality code. Please ask before making major architectural changes or introducing new dependencies. I value clear, concise explanations and prefer to see concrete examples for new features or complex implementations. I expect the agent to adhere to the established monorepo structure and follow TypeScript best practices.

# System Architecture

The project is a pnpm workspace monorepo using Node.js 24 and TypeScript 5.9.

**Core Technologies:**
- **Backend Framework:** Express 5.
- **Database:** PostgreSQL with Drizzle ORM.
- **Validation:** Zod for schema validation.
- **API Definition:** OpenAPI with Orval for client/Zod schema generation.
- **Build Tool:** esbuild.

**Monorepo Structure:**
- `artifacts/api-server`: Express 5 API with Clerk, OpenAI, and GCS integration.
- `artifacts/callcommand`: React + Vite frontend, dark mode UI.
- `artifacts/api-spec`: OpenAPI specification.
- `artifacts/db`: Database schema and migrations.
- `artifacts/scripts`: Utility scripts.

**Authentication:**
- Clerk (Replit-managed) for user authentication and authorization, including proxy integration and `clerkMiddleware`.

**AI Integration:**
- OpenAI via Replit AI Integrations for audio transcription (`gpt-4o-mini-transcribe`) and call analysis (`gpt-5.4` in JSON mode). Includes deterministic demo fallback.

**Object Storage:**
- Direct uploads to Google Cloud Storage (GCS) via presigned URLs for audio files. `upload_intents` table manages file upload states.

**PDF Generation:**
- `pdfkit` for generating reports.

**Billing & Plans:**
- `lib/plans.ts` defines subscription plans with monthly call limits. Stripe integration is present as a placeholder.

**UI/UX:**
- React + Vite frontend with dark mode.
- CRUD UIs for automation rules, tickets, leads, tasks, channels, receptionist profiles, and transfer targets.
- Dashboard widgets for system statistics.
- "Simulate inbound call" feature.
- Call detail page with "Flow Execution Trace".
- Switchboard view for live call sessions and quick actions.

**Business Automation Platform:**
- **Ownership Model:** Resources owned by Clerk `userId` (single-user workspace).
- **Rules Engine:** Evaluates `automation_rules` against analyzed calls to dispatch actions.
- **Action Engine:** Implements actions like `create_ticket`, `create_lead`, `create_task`, `send_webhook`, `send_slack`, `send_email`, `assign_user`, and `mark_priority`.
- **Ingestion Endpoints:** `/api/ingest/*` for Twilio, email, and generic webhooks, authenticated via per-user ingestion token. Creates call records, triggers analysis, and runs rules.
- **Multi-line Call Orchestration (Channels & Flows):**
    - `channels` table: manages inbound phone lines, including `live_behavior` and `receptionist_profile_id`.
    - `call_flows`: defines configurable call flows.
    - `flow_nodes`: represents steps within a flow (condition, action, AI decision, route).
    - `flow_logs`: chronological trace of flow execution.
    - `flowEngine`: executes flows with a loop guard.
- **Live AI Receptionist:** Uses `receptionist_profiles` for greetings, scripts, intake schema, and escalation rules. `live_call_sessions` tracks per-call live state. Multi-turn Twilio Gather processes AI intake via `/api/twilio/voice/gather`.
- **Call Control:** Real switchboard transfer via `services/twilioControl.ts` and `POST /api/live-sessions/:id/transfer`.
- **Business Hours Enforcement:** `lib/businessHours.ts` evaluates `channels.business_hours` for routing calls to `voicemail`, `forward`, `ai_intake_placeholder`, or `hangup`.
- **Recording Consent:** Channels can require consent (`requireRecordingConsent`) before recording, managed by `/api/twilio/voice/consent`.
- **Telephony Provider Abstraction:** Under `artifacts/api-server/src/services/telephony/` with Twilio implementation.
- **Productization Modes:** MSP, Sales, Field Service, Medical, General, seeding default channels, flows, and rules.

# External Dependencies

- **pnpm**: Monorepo management.
- **Node.js**: Runtime environment.
- **TypeScript**: Language.
- **Express**: Web application framework.
- **PostgreSQL**: Relational database.
- **Drizzle ORM**: TypeScript ORM.
- **Zod**: Schema validation.
- **Orval**: OpenAPI client generation.
- **esbuild**: JavaScript bundler.
- **Clerk**: Authentication and user management.
- **OpenAI**: AI services (transcription, analysis).
- **Google Cloud Storage (GCS)**: Object storage.
- **pdfkit**: PDF generation.
- **Stripe**: Payment processing (placeholder).
- **Twilio**: Inbound call recording webhooks, live call control.
- **Slack**: Notification integration.

# Phase 3 — Production-Readiness Hardening (final verification)

Run on May 02, 2026. All 10 production-gate items verified end-to-end against
the live api-server.

**Backend gate** — `pnpm --filter @workspace/scripts run gate:phase3-livecall`
(see `scripts/src/gatePhase3LiveCall.ts`). Provisions a synthetic test user
+ channels + receptionist profile, exercises the live `/api/twilio/voice/*`
webhooks (with `TWILIO_VALIDATE_SIGNATURE=false` only for the duration of
the run, restored immediately after), asserts TwiML shape AND HTTP 200,
directly invokes `runCallPipeline` and `redirectLiveCallToDial` via
cross-workspace dynamic import for true end-to-end runtime coverage of
items 8 and 9, and cleans up every test row in a single transaction at
the end (success or fail). Result: **42 / 42 PASS**.

**UI gate** — Playwright via `runTest({ testClerkAuth: true, ... })` covering
the channels editor, receptionist-profiles page, and switchboard.
Result: **success** (all `[Verify]` steps passed).

**HTTP smoke** — `bash scripts/smoke-phase3-hardening.sh` re-run with the
production env var settings restored. Result: **5 HTTP + 15 helper PASS**,
including the critical `POST /api/twilio/voice/incoming → 403` and
`POST /api/twilio/voice/consent → 403` for unsigned requests.

**Typecheck** — `pnpm run typecheck`. Result: **clean** (libs build + 4
leaf workspace packages: api-server, callcommand, mockup-sandbox, scripts).

| # | Item | Verified by | Result |
|---|------|-------------|--------|
| 1 | UI creates a channel with `liveBehavior=ai_receptionist` | UI gate (channels editor → "AI receptionist (multi-turn intake)") | PASS |
| 2 | Channel persists across browser refresh | UI gate (reload `/channels`, channel still present) | PASS |
| 3 | Receptionist profile assignment persists across refresh | UI gate (assign profile → reload → re-open editor → still selected) | PASS |
| 4 | After-hours TwiML follows `afterHoursBehavior` | Backend gate, all four branches: `voicemail`(allowed → `<Record>` / denied → `<Hangup>`), `forward`(with number → `<Dial>` / without → graceful degrade to `<Record>`), `hangup` → `<Hangup>`. Plus `ai_after_hours_intake` only engages AI after-hours. | PASS |
| 5 | In-hours TwiML follows `liveBehavior` | Backend gate: `ai_receptionist` → `<Gather action=…/voice/gather>`, `record_only` → `<Record>` (no `<Gather>`), `ai_after_hours_intake` (in-hours) does NOT engage AI. | PASS |
| 6 | Recording-consent gate blocks recording until consent | Backend gate: pre-consent response is `<Gather action=…/voice/consent>` (NOT `/voice/gather`), no `<Record>` and no greeting leak. `Digits=1` → main flow re-enters with `<Record>` + `consent:accepted` event. `Digits=2` → `<Hangup>` + `consent:declined` event. Empty `Digits` → `<Hangup>` + `consent:no_response` event. | PASS |
| 7 | Duplicate phone number returns 409 | UI gate (second create with same E.164 → destructive error toast, no second card in list); also covered by smoke for the unauth path. | PASS |
| 8 | Live transfer either real Twilio redirect OR honest unsupported error | Backend gate (runtime): `/api/live-sessions/:id/transfer` returns 401 without Clerk session; `redirectLiveCallToDial` is invoked directly with three input shapes — `{callSid:null}` → `no_call_sid`, `{targetPhoneE164:null}` → `no_target_phone`, valid args without Twilio creds → `logged_no_provider` (or `failed` when creds present + bogus SID). `redirectStatusToTransferLog` mapping verified (`logged_no_provider`→`failed`, `redirected`→`bridged`) so the audit trail can never silently say "ok". | PASS |
| 9 | Twilio `From` (callerPhone) survives the full pipeline | Backend gate (runtime): `runCallPipeline` is invoked end-to-end against a seeded call record. With Twilio "From" `+15551234567` pre-set and the demo analysis returning `+1 415-555-0142`, the post-pipeline row STILL has `+15551234567` and reaches `status=ready`. A separate run with `callerPhone=null` proves the demo number does populate when nothing existed — confirming the COALESCE is one-way. SQL-level COALESCE semantics are also exercised independently. | PASS |
| 10 | Switchboard reflects live channel/session state | UI gate (`/switchboard` loads, `[data-testid^="switchboard-channel-"]` contains the newly created channel). | PASS |

**Telephony events emitted during the gate** (sanity-check that the audit
trail is intact): `incoming`, `after_hours:voicemail`, `after_hours:forward`,
`after_hours:hangup`, `consent:accepted`, `consent:declined`,
`consent:no_response`.

**Operational notes for production cutover**
- `TWILIO_VALIDATE_SIGNATURE` must remain unset (or `true`) in production —
  the gate run flips it `false` only briefly and the orchestrator restores
  it via `setEnvVars` / restart before the smoke re-runs.
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` must be set in production for
  switchboard transfers to actually redirect. Without them, transfers
  return the honest `logged_no_provider` audit row instead of silently
  succeeding (as required by item 8).