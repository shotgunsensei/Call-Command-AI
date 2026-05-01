# CallCommand AI

Production-grade inbound voice intelligence: ingest live phone calls,
transcribe them, classify intent / priority / sentiment, run
tenant-defined call flows, and trigger downstream automation
(tickets, leads, tasks, webhooks).

This README covers **Phase 2 — Production Telephony** and the
**Phase 3 — Live AI Receptionist + Transfer Logic** layer on top of
it. For the underlying call-flow orchestration, automation rules, and
AI pipeline introduced in Phase 1, see the in-app docs and
`replit.md`.

---

## Phase 3 — Live AI Receptionist (current)

Phase 3 turns the system from a recorder-and-analyzer into a real-time
voice agent that answers, screens, intakes, and transfers calls.

### Live behaviors (per channel)

`channels.live_behavior` controls how Twilio webhooks branch:

| Value | What it does |
| --- | --- |
| `record_only` | Phase 2 behavior — greet, record, transcribe afterward. |
| `forward_only` | Forward straight to `forward_number`, no AI. |
| `voicemail_only` | Skip the human, take a voicemail immediately. |
| `ai_receptionist` | Multi-turn intake with the AI receptionist. |
| `ai_screen_then_transfer` | AI collects context, then dials a transfer target. |
| `ai_after_hours_intake` | AI engages only outside business hours. |

### Multi-turn `<Gather>` flow

`POST /api/twilio/voice/incoming` decides whether to start a live
session and respond with a `<Gather input="speech">` greeting.

`POST /api/twilio/voice/gather` is hit on every caller turn:

1. Validate the Twilio signature (same path used by the recording
   webhook).
2. De-duplicate via `telephony_events.providerEventId` so retried
   webhooks are no-ops.
3. Look up the `live_call_sessions` row by `provider_call_sid` and
   append the `SpeechResult` to `transcript_live`.
4. Run the **intake engine** (`lib/intakeEngine.ts`) to extract any
   missing field from the latest utterance and pick the next question.
5. Run the **escalation evaluator** (`lib/escalation.ts`) to detect
   emergency keywords, angry sentiment, or VIP callers.
6. Call the **AI decision service** (`services/liveReceptionist.ts`)
   for the reply, recommended action, and any business-object
   creation. The service uses OpenAI (`gpt-5.4`,
   `response_format: json_object`) when `AI_INTEGRATIONS_OPENAI_*` env
   vars are present, otherwise falls back to a deterministic demo
   responder. Bad JSON is swallowed — the service never throws into
   the webhook.
7. Persist the session and return the next TwiML: another question, a
   `<Dial>` to the chosen transfer target, a `<Record>` voicemail, or
   a polite hang-up.

### Intake schema

Each receptionist profile owns an `intake_schema` jsonb of the form

```json
{ "fields": [
  { "key": "name",   "label": "Caller name",       "required": true },
  { "key": "phone",  "label": "Callback number",   "required": true },
  { "key": "reason", "label": "Reason for calling","required": true }
]}
```

Edit profiles at `/receptionist-profiles`. The receptionist asks each
missing required field one at a time, then either transfers, takes
voicemail, or ends the call based on the AI decision.

### Transfer targets

`/transfer-targets` manages where the AI may hand off live calls:

* `external_number` (E.164) — `<Dial>` straight to a phone number.
* `voicemail` — fall through to the channel's voicemail.
* `user` / `queue` — placeholders for upcoming releases.

Operators can also transfer manually from the live switchboard using
the same target list.

### Escalation rules

Each receptionist profile owns `escalation_rules` jsonb:

* `emergencyKeywords` — comma-separated trigger phrases.
* `vipNumbers` — E.164 callers who escalate immediately.
* `angrySentimentEscalates` — escalate if AI tags the call angry/upset.
* `afterHoursEmergencyTransferTargetId` — optional after-hours fallback.

When triggered, the session is marked `escalated`, the
`escalation_reason` is recorded, and the next webhook turn responds
with the profile's escalation script + `<Dial>` to the configured
target (or voicemail if none).

### Voicemail callback

When a `<Record>` voicemail recording arrives at
`/api/twilio/voice/recording`, the existing Phase 2 pipeline runs
end-to-end. If a `live_call_sessions` row exists for that CallSid,
its `session_status` becomes `voicemail` and a follow-up task / ticket
is created using the AI's recommended action (de-duplicated via
`session.created_object_ids`).

### Live switchboard

`/switchboard` now polls every **4s** and shows live AI sessions on
top with quick actions: **Mark urgent**, **Transfer**, **Add note**,
**End**, plus a **Detail** link to the underlying call record. Each
card surfaces the current step, collected fields, recent transcript,
escalation reason, and AI summary.

### Live-call simulator

`/simulate/live-call` lets you have a multi-turn conversation with the
receptionist without burning Twilio minutes. Sessions are flagged
`is_demo = "true"` so they never enter production analytics.

### Recording-consent UX

Per channel:

* `require_recording_consent` — play the consent script before the
  greeting.
* `consent_script` — the line played to the caller.
* `consent_required_before_recording` — when true, no audio is captured
  until consent is acknowledged. **You are responsible for compliance
  with local two-party consent law.**

### Product modes (Phase 3 additions)

Each product mode (MSP, Sales, Field Service, Medical, General) now
seeds default receptionist profiles + transfer targets in addition to
channels and flows. Seeding is idempotent — apply the same mode twice
and only missing resources are created.

> **Medical mode is administrative only.** It collects appointment /
> callback intake. The receptionist never gives medical advice, never
> diagnoses, and never triages clinical urgency beyond "is this an
> emergency? if yes, hang up and call 911."

> **Automotive use** is supported for scheduling / quoting only. The
> receptionist never diagnoses vehicle problems.

### Server-side AI keys only

The decision service runs **only on the API server**. The frontend
never sees an AI key. If `AI_INTEGRATIONS_OPENAI_API_KEY` and
`AI_INTEGRATIONS_OPENAI_BASE_URL` are missing, the service uses a
deterministic demo responder so the entire flow still works on a
fresh Replit clone.

---

## Phase 2 in a nutshell

* **Provider abstraction.** `services/telephony/` defines a
  `TelephonyProvider` interface implemented by `twilioProvider` (live)
  and stub adapters for `sip`, `asterisk`, and `freepbx` (TODO).
* **Channel-aware TwiML.** Each channel owns greeting text, recording
  toggle, voicemail toggle, business hours, after-hours behavior,
  forward-number, max call duration, recording-consent text, and an
  assigned flow.
* **E.164 multi-line routing.** Inbound `To` is normalized to E.164
  and matched against `channels.phone_number`. Unmatched lines fall
  through to the user's default channel; if no default exists, the
  caller hears a polite "not configured" message.
* **Recording pipeline.** Twilio recording webhooks are idempotent
  (`recordings_call_sid_unique` index). The recording is downloaded
  with Twilio HTTP Basic auth and fed into the same `processCallAudio`
  pipeline used by uploads, then transitioned through
  `transcribing → analyzing → flow_running → ready`.
* **Telephony events log.** Every webhook hit is appended to
  `telephony_events` (provider, eventType, providerEventId, raw
  payload). Visible per-call in the UI.
* **Switchboard.** `/switchboard` polls every 7s and shows every
  channel with its 24-hour call traffic.
* **Setup wizard.** `/setup/telephony` walks an operator through
  picking a product mode (MSP / Sales / Field Service / Medical /
  General), wiring Twilio, and verifying.

---

## Required environment variables

Set these as Replit secrets, **never** commit them.

| Variable                 | Purpose                                                |
|--------------------------|--------------------------------------------------------|
| `TWILIO_ACCOUNT_SID`     | Twilio Account SID. Required for signature validation. |
| `TWILIO_AUTH_TOKEN`      | Twilio Auth Token. Required for signature + recording download. |
| `TWILIO_WEBHOOK_BASE_URL` | (Optional) Override the public webhook base URL. Defaults to `REPLIT_DEV_DOMAIN` in dev and the first `REPLIT_DOMAINS` host in prod. |
| `DATABASE_URL`           | PostgreSQL (Phase 1).                                  |
| `SESSION_SECRET`         | Express session signing (Phase 1).                     |

The setup wizard surface card on `/setup/telephony` shows which of
these are present (without echoing values).

---

## Twilio webhook setup

1. In the Twilio Console go to **Phone Numbers → Active numbers →
   {your number} → Voice Configuration**.
2. Set the following URLs to your CallCommand instance. Either copy
   them from the wizard at `/setup/telephony`, or build them from
   `https://<your-domain>`:
   * **A call comes in:** `https://<host>/api/twilio/voice/incoming` (HTTP POST)
   * **Call status changes:** `https://<host>/api/twilio/voice/status` (HTTP POST)
   * **Recording status callback:** `https://<host>/api/twilio/voice/recording` (HTTP POST)
   * **Transcription callback (optional):** `https://<host>/api/twilio/voice/transcription` (HTTP POST)
3. Save. Place a test call. Watch it appear on `/switchboard`.

The incoming endpoint validates the `X-Twilio-Signature` header using
your Auth Token. Requests without a valid signature get **403** and
no DB writes happen.

---

## Channel → phone-number mapping

* Set the channel's **Phone number** in E.164 (`+15551234567`).
* On every inbound call we normalize Twilio's `To` to E.164 and look
  up the matching channel.
* Missing or empty matches fall back to the user's default channel
  (`is_default = true`). The default channel is auto-seeded on first
  ingest and cannot be deleted from the UI.
* Channel toggles you'll likely use in production:
  * `recordCalls` — emit `<Record>` / `Dial record="record-from-answer-dual"`.
  * `allowVoicemail` — controls voicemail beep + finish-on-`#`.
  * `forwardNumber` — bridges to a PSTN number; recording the bridged leg is honored.
  * `maxCallDurationSeconds` — fed into Twilio `timeLimit` / `maxLength`.
  * `assignedFlowId` — overrides per-channel flow selection.
  * `recordingConsentText` — played as `<Say>` before connecting if recording is on.

---

## Recording consent

If `recordCalls` is enabled, CallCommand will play the channel's
`recordingConsentText` (default: *"This call may be recorded for
quality and training purposes."*) before connecting. **You are
responsible for compliance** with local two-party consent / wiretap
laws. The consent text is editable per-channel.

---

## Local / Replit development

* CallCommand is served behind the Replit shared proxy. The
  `TWILIO_WEBHOOK_BASE_URL` defaults to `https://$REPLIT_DEV_DOMAIN`
  in development and the first `REPLIT_DOMAINS` host in published
  apps.
* If you're testing from outside Replit, point Twilio at any HTTPS
  tunnel (ngrok, Cloudflare Tunnel) that fronts port 80.
* The Twilio webhooks intentionally **do not** use Clerk auth — they
  rely on signature validation. They also accept `urlencoded` form
  bodies, so they're mounted before the JSON body parser collides
  with them.

---

## Recording pipeline

```
Twilio /recording webhook
   │  (idempotent on RecordingSid)
   ▼
attach recording_url + recording_sid + duration to call_records
   │
   ▼
runCallPipeline()
   transcribing → analyzing → flow_running → ready
```

* Downloads use `axios` with HTTP Basic auth (Account SID + Auth
  Token).
* Re-runs are exposed via `POST /api/calls/:id/retry-processing`
  (Clerk auth). The Call Detail page wires this into the *Reprocess*
  button automatically when `provider === "twilio"`.

---

## SIP / Asterisk / FreePBX (future)

The provider interface is implemented by stub files
(`sipProvider`, `asteriskProvider`, `freepbxProvider`). They
deliberately throw on `validateRequest` so they can't be silently
enabled. They share the same TwiML-shape adapter contract, so a real
SIP/Asterisk implementation only needs to:

1. Implement signature/IP-allowlist validation.
2. Translate inbound INVITE / ARI / AMI events into the
   `IncomingCallContext` returned by `parseIncoming`.
3. Either generate AGI-equivalent dialplan responses or proxy to a
   normal Twilio-compatible bridge.

---

## Security notes

* Webhooks: always signature-validated, never Clerk-authenticated.
* Recording URLs: stored as the Twilio-hosted URL; downloads use
  server-side credentials so the URL itself is never exposed to the
  browser.
* Telephony events store the raw provider payload as JSONB, scoped to
  the user. The UI strips the raw payload from the timeline view.
* Recording consent text is per-channel and customer-owned. We do not
  enforce a universal disclaimer beyond seeding a sensible default.

---

## Productization modes

`/setup/telephony` can seed any of:

* **MSP** — IT/MSP support intake, ticket-first.
* **Sales** — Inbound sales, lead-first.
* **Field Service** — Dispatch + job scheduling.
* **Medical** — Administrative intake only. Never produces medical
  diagnosis or advice. Calls are flagged as "intake" and routed to
  scheduling templates.
* **General** — Neutral starter for any inbound call workflow.

Re-applying a mode is **idempotent** — only empty slots
(zero-of-resource for that user) are filled, so existing channels /
flows / rules are never overwritten.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Twilio webhook returns **403** | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` unset, or the public URL Twilio is hitting differs from `TWILIO_WEBHOOK_BASE_URL`. |
| Inbound call hears "not configured" | `To` doesn't match any channel and the user has no `is_default=true` channel. Create one or run the setup wizard. |
| Call stays in `recording_ready` forever | Recording download failed. Check the API server logs for the request id; re-run via *Reprocess* on the Call Detail page. |
| Call detail shows no telephony events | The call was ingested via upload or simulator (no provider). Expected. |
