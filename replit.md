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
