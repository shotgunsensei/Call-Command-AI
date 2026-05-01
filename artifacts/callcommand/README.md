# CallCommand AI

Production-grade inbound voice intelligence: ingest live phone calls,
transcribe them, classify intent / priority / sentiment, run
tenant-defined call flows, and trigger downstream automation
(tickets, leads, tasks, webhooks).

This README covers **Phase 2 — Production Telephony**. For the
underlying call-flow orchestration, automation rules, and AI pipeline
introduced in Phase 1, see the in-app docs and `replit.md`.

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
