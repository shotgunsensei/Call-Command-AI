# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **`artifacts/api-server`** — Express 5 API for CallCommand AI. Mounts the Clerk
  proxy before body parsers, uses `clerkMiddleware` with
  `publishableKeyFromHost`, and `requireAuth` middleware that auto-upserts
  users via the Clerk SDK on first hit. Routes: `/api/healthz`, `/api/me`,
  `/api/calls`, `/api/calls/:id`, `/api/calls/:id/process`,
  `/api/calls/:id/webhook`, `/api/calls/:id/pdf`, `/api/action-items/:id`,
  `/api/integrations`, `/api/integrations/:id`, `/api/integrations/:id/test`,
  `/api/stats/dashboard`, `/api/billing/plan`, `/api/billing/checkout`, plus
  storage routes from the object-storage skill.
- **`artifacts/callcommand`** — React + Vite frontend (dark mode by default,
  `<html class="dark">`). Wires `<ClerkProvider publishableKey={…}
  proxyUrl={…} routing="path" appearance={…red theme}>`. Uses generated
  `@workspace/api-client-react` hooks for every endpoint. Upload flow requests
  presigned URL, PUTs file directly to GCS, then POSTs the object path to
  `/api/calls`.

## CallCommand AI

Production app that turns phone-call recordings into structured intelligence.

**Stack additions on top of the base:**
- **Auth**: Clerk (Replit-managed) — proxy + `publishableKeyFromHost`.
- **AI**: OpenAI via `AI_INTEGRATIONS_OPENAI_*` env (Replit AI Integrations).
  Falls back to a fully-fleshed-out demo transcript + analysis when no key is
  present or transcription is too short. Models: `gpt-4o-mini-transcribe` for
  audio, `gpt-5.4` for analysis (JSON mode).
- **Object storage**: audio files uploaded directly to GCS via presigned URL,
  path stored on `call_records.fileUrl`.
- **PDF**: `pdfkit` red-accent report generated on demand at
  `/api/calls/:id/pdf`. **Note**: `@swc/helpers` is a runtime dep of
  `api-server` because `pdfkit → fontkit → brotli` requires it at runtime
  and `@swc/*` is externalized in the esbuild bundle.
- **Plans**: `lib/plans.ts` defines free (10), pro (100/$29), business
  (500/$79), msp (2000/$199). Monthly limits are enforced on
  `POST /api/calls`.
- **Stripe**: placeholder — `/api/billing/checkout` returns
  `{configured:false}` when `STRIPE_SECRET_KEY` is missing.

## Database Schema

- `users` — Clerk userId (varchar primary key), email, name, avatarUrl, plan,
  optional `stripeCustomerId`/`stripeSubscriptionId`.
- `call_records` — userId, originalFilename, fileUrl, transcriptText,
  summary, customer/company/phone, callType, intent, priority, sentiment,
  status (`processing`/`ready`/`error`), durationSeconds, jsonb keyPoints,
  followUpMessage, internalNotes, jsonb crmJson, jsonb suggestedTags,
  `isDemo` (text "true"/"false"), errorMessage.
- `action_items` — callRecordId, title, description, dueDate, priority,
  status (`open`/`in_progress`/`done`).
- `integrations` — userId, type (`crm`/`zapier`/`make`/`webhook`/`slack`),
  name, webhookUrl, enabled.

## 2026-05-01 Audit Pass

Front-end / back-end alignment fixes for the MVP audit:
- Calls list filter and badges now use the real status enum
  (`processing`/`ready`/`error`) and render friendly labels
  (Processing / Completed / Failed).
- Call detail page checks `status === "error"` and toggles action items
  between `open` and `done` (matches `stats.ts` open-count query).
- `POST /api/storage/uploads/request-url` and `GET /api/storage/objects/*`
  now require Clerk auth. Downloads additionally require the caller to own a
  `call_records` row whose `fileUrl` matches the requested object path.
- Billing page always toasts when checkout returns no URL (previously
  silent when Stripe was "configured" but checkout was unavailable).
- Sidebar active-state no longer double-highlights `/calls` for `/calls/new`.
- Sign-out (Settings + Layout dropdowns) redirects to `/` instead of
  leaving the user on an authenticated page that hangs on a loader.

## 2026-05-01 Launch hardening

Two post-MVP hardening items from the audit are now in place.

### upload_intents table

New table `upload_intents` (`id uuid pk`, `user_id varchar(64)`,
`workspace_id varchar(64) null`, `object_path text unique`,
`original_filename`, `mime_type`, `max_size_bytes bigint`,
`status pending|uploaded|attached|expired`, `created_at`, `expires_at`,
indexes on `user_id` and `status`).

- `POST /api/storage/uploads/request-url` now creates a `pending` intent
  (24h TTL) bound to the authenticated user before returning the upload URL.
- `POST /api/calls` runs the claim and the `call_records` insert inside a
  single `db.transaction`. The claim is an atomic conditional
  `UPDATE … RETURNING` (helper: `claimUploadIntent` in
  `lib/db/src/uploadIntents.ts`) that flips the intent to `attached` only
  when the row belongs to the caller, is in `pending`/`uploaded`, and has
  not expired. Two concurrent attach attempts for the same `object_path`
  race on this UPDATE — exactly one wins; the other receives
  `already_attached`. Status codes: 403 / 410 / 409. If the call insert
  fails (or the process dies mid-transaction) the claim is rolled back, so
  the user can retry without being permanently stuck on 409.
- The `status` column has a Postgres CHECK constraint
  (`pending|uploaded|attached|expired`) so application bugs cannot write an
  invalid state.
- `GET /api/storage/objects/*` allows downloads when either (a) the caller
  owns a `call_records` row whose `file_url` matches, or (b) the caller owns
  a non-expired upload intent for that path. (b) covers the brief window
  between upload and `POST /api/calls`.
- `expireStaleUploadIntents()` helper marks past-due `pending`/`uploaded`
  intents as `expired`; safe to call from any housekeeping path.

### Legacy file URL migration

`scripts/src/normalizeCallFileUrls.ts` rewrites legacy
`call_records.file_url` values into the canonical `/objects/<id>` form.

- Skips already-canonical rows and NULL/empty values.
- Logs (does not delete) anything it cannot recognise.
- Idempotent — safe to re-run.
- Run with: `pnpm --filter @workspace/scripts run normalize-call-file-urls`
  (append `-- --dry-run` to preview).

### Smoke checks

`pnpm --filter @workspace/scripts run test:upload-hardening` exercises the
same `claimUploadIntent` helper that the production route calls — so a
regression in the attach-guard is a smoke failure. Six checks: unauth 401,
intent persists as `pending`, cross-user denial, expired denial, valid claim
(and `already_attached` on re-claim), and an 8-trial concurrent-claim race
that asserts exactly one of two parallel attach attempts wins.

## 2026-05-01 Business Automation Platform

CallCommand AI now operates as an end-to-end business-automation platform on
top of the existing audio pipeline. **No prior functionality was removed** —
all upload / analysis / integration paths still work; the platform sits on
top.

### Ownership model

Every new resource is owned by the Clerk `userId` directly. The "workspace"
is a single-user workspace for the MVP (documented here so a future
multi-tenant migration only adds a `workspace_id` join column).

### New tables

- `automation_rules` — JSONB `conditions` + JSONB `actions` evaluated against
  every analyzed call. Conditions use simple subset matching:
  `callType`, `intent`, `priority`, `sentiment`, `tagIncludes` (string or
  array), `isDemo` (string `"true"`/`"false"`). Actions are typed:
  `create_ticket`, `create_lead`, `create_task`, `send_webhook`. `is_default`
  marks the seeded starter rules.
- `tickets` — `userId`, `linkedCallId`, `title`, `description`, `priority`,
  `status (open|in_progress|closed)`.
- `leads` — `userId`, `linkedCallId`, `name`, `phone`, `company`, `intent`,
  `status (new|qualified|contacted|closed|lost)`.
- `tasks` — `userId`, `linkedCallId`, `title`, `description`, `dueDate`,
  `status (open|in_progress|done)`.
- `followup_logs` — `userId`, `callRecordId`, `channel`, `recipient`,
  `subject`, `message`, `status`. Entries are saved when the user clicks
  "Send follow-up"; they are *logged* (no email/SMS sent in-app — wire a
  `send_webhook` rule to deliver via your provider).
- `ingestion_events` — audit log of inbound `twilio` / `email` / `webhook` /
  `demo` events. References the resulting `call_record_id` plus the raw
  payload for replay/debugging.
- `users.ingestion_token_hash` — SHA-256 hash (hex) of the per-user opaque
  token (`cci_` + base64url) used for inbound webhook auth. Indexed
  uniquely. The raw token is **never** persisted; it is shown to the user
  exactly once at rotation time.

### Rules engine

`artifacts/api-server/src/services/rulesEngine.ts` exposes:

- `ensureDefaultRules(userId)` — seeds three starter rules on first use:
  support → ticket, sales → lead, scheduling/follow-up → task. Idempotent.
- `evaluateAndExecuteRules({userId, call})` — fetches enabled rules, matches
  conditions against the analyzed call, and dispatches each matched action
  to the action engine. Errors are swallowed per-action so one broken rule
  cannot break a sibling.
- `runRulesWithDefaults({userId, call})` — the public API used by the
  `POST /api/calls/:id/run-rules` endpoint; ensures defaults then runs
  evaluation. Returns `{rulesEvaluated, rulesMatched, actionsExecuted, log}`.

The engine is hooked into the call pipeline at the end of
`runProcessing()` in `routes/calls.ts` — any successful upload or reprocess
runs the rules. Failures are non-fatal (the call has already been persisted).

### Action engine

`artifacts/api-server/src/services/actions.ts` implements each action type:

- `create_ticket` / `create_lead` / `create_task` — insert a new row scoped
  to the user, link to the originating call.
- `send_webhook` — POST a JSON envelope (`{ event, call, action }`) to
  either an `integrationId` from the user's integrations or a literal `url`,
  using `lib/safeWebhook` for SSRF protection.

### Ingestion endpoints (Bearer token)

All under `/api/ingest/*`, authenticated via
`requireIngestionToken`. The middleware hashes the candidate token with
SHA-256 in app space, looks up `users.ingestion_token_hash` by that
indexed digest (uniformly distributed → no per-byte timing leak), and
runs a final `crypto.timingSafeEqual` over the hash bytes as
defence-in-depth. Supports `Authorization: Bearer <token>`,
`X-Ingestion-Token`, or `?token=` query:

- `POST /api/ingest/twilio` — accepts Twilio recording webhooks
  (`From`, `RecordingUrl`, `CallSid`, …).
- `POST /api/ingest/email` — generic email-to-call (`from`, `subject`,
  `body`, `attachmentUrl`).
- `POST /api/ingest/webhook` — free-form JSON
  (`customerName`, `callerPhone`, `fileUrl`, `label`).

Each creates a `call_records` row + `ingestion_events` entry, runs analysis
(real OpenAI or demo fallback), then runs rules. Returns `202` + `{callId,
eventId}`. Plan limits are enforced — over limit returns `402` and writes a
`rejected` ingestion event.

`POST /api/demo/simulate-call` (Clerk auth) — same pipeline with `source:
"demo"`; powers the "Simulate inbound call" dashboard button. Redirects the
user to the resulting call detail page.

### New REST endpoints

- `GET /api/me/ingestion-token` — returns `{ token: null, hasToken,
  endpoints }`. The raw token is never re-revealed because only its hash
  is stored.
- `POST /api/me/ingestion-token` — generates a new token, stores its
  SHA-256 hash, and returns the raw token **once** in the response so the
  UI can copy it. Also returns the three ingestion endpoint paths so the
  UI can prefix them with `window.location.origin`.
- `GET/POST/PATCH/DELETE /api/automation-rules[/:id]`
- `GET/PATCH/DELETE /api/tickets[/:id]`
- `GET/PATCH/DELETE /api/leads[/:id]`
- `GET/PATCH/DELETE /api/tasks[/:id]`
- `GET /api/follow-ups`, `POST /api/calls/:id/follow-up`
- `POST /api/calls/:id/run-rules`
- `GET /api/ingestion-events`

### Dashboard widgets

`/api/stats/dashboard` adds `openTickets`, `newLeadsThisWeek`, `openTasks`,
`angrySentimentAlerts`, and `conversionFunnel: {calls, leads, closedLeads}`
(this month). Existing fields are unchanged. The dashboard renders a second
row of stat cards (linkable to /tickets, /leads, /tasks) and a 3-step
funnel; a "Simulate inbound call" button calls `/api/demo/simulate-call`
and routes to the new call.

### Frontend pages

`/tickets`, `/leads`, `/tasks`, `/automation-rules` — CRUD UIs with status
selects. The Integrations page now has a top "Inbound ingestion" panel that
reveals/rotates the bearer token and shows ready-to-paste
`POST <origin>/api/ingest/{twilio,email,webhook}` URLs with copy buttons.
The Call Detail page now has "Run rules" and "Send follow-up" buttons
alongside "Reprocess".
