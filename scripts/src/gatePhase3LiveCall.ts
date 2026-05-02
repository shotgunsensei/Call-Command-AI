/**
 * Final production gate for Phase 3 live-call behavior.
 *
 * Exercises items 4, 5, 6, 8, 9 from the gate plan against the running
 * api-server. UI items (1, 2, 3, 7, 10) are covered by a parallel
 * Playwright runTest() because they require Clerk auth + visual checks.
 *
 * Pre-reqs:
 *   - api-server running at http://localhost:80 (Replit shared proxy).
 *   - TWILIO_VALIDATE_SIGNATURE=false in dev so we can POST to the
 *     /voice/* webhooks without a real Twilio signature. Restored by the
 *     orchestrator after the gate completes.
 *
 * Cleanup:
 *   - Every test row is owned by a synthetic userId scoped to this run
 *     and deleted in a single transaction at the end (success or fail).
 */

import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  db,
  pool,
  channelsTable,
  receptionistProfilesTable,
  callRecordsTable,
  telephonyEventsTable,
} from "@workspace/db";
import { and, eq, like, sql } from "drizzle-orm";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Cross-workspace dynamic import of an api-server source file. We
 * deliberately use an `any`-typed dynamic import so the scripts package
 * stays inside its own typecheck boundary while still being able to
 * exercise real api-server code paths at runtime. tsx resolves the `.ts`
 * extension on the fly.
 */
async function importApiServer(relPath: string): Promise<any> {
  const abs = resolve(HERE, "../../artifacts/api-server/src", relPath);
  return await import(pathToFileURL(abs).href);
}

const BASE = process.env.GATE_BASE ?? "http://localhost:80";
const RUN_ID = `gate_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
const TEST_USER = `_gate_${RUN_ID}`;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string): void {
  console.log(`\x1b[32mPASS\x1b[0m  ${name}`);
  pass += 1;
}
function bad(name: string, why: string): void {
  console.log(`\x1b[31mFAIL\x1b[0m  ${name}\n         → ${why}`);
  fail += 1;
  failures.push(`${name}: ${why}`);
}
function expect(name: string, cond: boolean, why: string): void {
  if (cond) ok(name);
  else bad(name, why);
}

// ---------- HTTP helpers ----------

async function postForm(
  path: string,
  form: Record<string, string>,
): Promise<{ status: number; body: string; headers: Headers }> {
  const body = new URLSearchParams(form).toString();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return { status: res.status, body: await res.text(), headers: res.headers };
}

// ---------- Setup ----------

interface ChannelSetup {
  name: string;
  phoneE164: string;
  liveBehavior:
    | "record_only"
    | "forward_only"
    | "voicemail_only"
    | "ai_receptionist"
    | "ai_screen_then_transfer"
    | "ai_after_hours_intake";
  afterHoursBehavior: "voicemail" | "forward" | "ai_intake_placeholder" | "hangup";
  allowVoicemail: boolean;
  forwardNumber: string | null;
  recordCalls: boolean;
  businessHoursClosed: boolean;
  consentGate?: boolean;
  receptionistProfileId?: string | null;
}

async function createChannel(
  setup: ChannelSetup,
): Promise<{ id: string; phoneE164: string }> {
  // "Closed" hours = a weekly window that is empty for every day, which
  // forces `isWithinBusinessHours` to return false. "Open" = mode=always.
  const businessHours = setup.businessHoursClosed
    ? {
        mode: "weekly" as const,
        timezone: "UTC",
        weekly: {
          sun: null,
          mon: null,
          tue: null,
          wed: null,
          thu: null,
          fri: null,
          sat: null,
        },
      }
    : { mode: "always" as const };

  const [row] = await db
    .insert(channelsTable)
    .values({
      userId: TEST_USER,
      name: setup.name,
      phoneNumber: setup.phoneE164,
      type: "twilio",
      isActive: true,
      isDefault: false,
      greetingText: "Gate test greeting.",
      recordCalls: setup.recordCalls,
      allowVoicemail: setup.allowVoicemail,
      businessHours,
      afterHoursBehavior: setup.afterHoursBehavior,
      forwardNumber: setup.forwardNumber,
      maxCallDurationSeconds: null,
      recordingConsentText: null,
      liveBehavior: setup.liveBehavior,
      receptionistProfileId: setup.receptionistProfileId ?? null,
      requireRecordingConsent: setup.consentGate === true,
      consentScript:
        setup.consentGate === true
          ? "Please press 1 to consent to recording, or 2 to decline."
          : null,
      consentRequiredBeforeRecording: setup.consentGate === true,
    })
    .returning({ id: channelsTable.id, phoneNumber: channelsTable.phoneNumber });
  return { id: row!.id, phoneE164: row!.phoneNumber! };
}

async function createProfile(): Promise<string> {
  const [row] = await db
    .insert(receptionistProfilesTable)
    .values({
      userId: TEST_USER,
      name: "Gate test profile",
      voiceProvider: "twilio",
      greetingScript: "Hello and thank you for calling. Gate test profile speaking.",
      fallbackScript: "Sorry, please call back later.",
      escalationScript: null,
      voicemailScript: null,
      tone: "professional",
      intakeSchema: {
        fields: [
          { key: "callerName", label: "Caller name", required: true },
          { key: "reason", label: "Reason for the call", required: true },
        ],
      },
      escalationRules: {},
      enabled: true,
      isDefault: true,
    })
    .returning({ id: receptionistProfilesTable.id });
  return row!.id;
}

// ---------- Cleanup ----------

async function cleanup(): Promise<void> {
  await db
    .delete(telephonyEventsTable)
    .where(eq(telephonyEventsTable.userId, TEST_USER));
  await db
    .delete(callRecordsTable)
    .where(eq(callRecordsTable.userId, TEST_USER));
  await db
    .delete(channelsTable)
    .where(eq(channelsTable.userId, TEST_USER));
  await db
    .delete(receptionistProfilesTable)
    .where(eq(receptionistProfilesTable.userId, TEST_USER));
  // Belt-and-suspenders: any leftover gate users from interrupted runs.
  await db.execute(
    sql`DELETE FROM telephony_events WHERE user_id LIKE '_gate_%' AND created_at < NOW() - interval '1 day'`,
  );
}

// ---------- Tests ----------

async function postIncoming(args: {
  toE164: string;
  fromE164?: string;
  callSid?: string;
}): Promise<{ status: number; body: string }> {
  const callSid = args.callSid ?? `CAgate${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  return postForm("/api/twilio/voice/incoming", {
    CallSid: callSid,
    From: args.fromE164 ?? "+15555550100",
    To: args.toE164,
    AccountSid: "ACgate-test",
    Direction: "inbound",
  });
}

async function postConsent(args: {
  toE164: string;
  fromE164?: string;
  digits: string;
  callSid: string;
}): Promise<{ status: number; body: string }> {
  return postForm("/api/twilio/voice/consent", {
    CallSid: args.callSid,
    Digits: args.digits,
    From: args.fromE164 ?? "+15555550100",
    To: args.toE164,
    AccountSid: "ACgate-test",
  });
}

function uniquePhone(): string {
  // Use the +1-555-01XX block reserved for fictitious testing.
  const last = String(8000 + Math.floor(Math.random() * 1999)).padStart(4, "0");
  return `+1555555${last}`;
}

async function runGate(): Promise<void> {
  console.log(`Gate run: ${RUN_ID}`);
  console.log(`Base URL: ${BASE}`);
  console.log(`Test user: ${TEST_USER}\n`);

  // ===== Item 5 — In-hours, AI receptionist =====
  console.log("\x1b[33m=== Item 5: in-hours liveBehavior=ai_receptionist ===\x1b[0m");
  const profileId = await createProfile();
  const aiOpenChan = await createChannel({
    name: "AI open",
    phoneE164: uniquePhone(),
    liveBehavior: "ai_receptionist",
    afterHoursBehavior: "hangup",
    allowVoicemail: true,
    forwardNumber: null,
    recordCalls: true,
    businessHoursClosed: false,
    receptionistProfileId: profileId,
  });
  {
    const r = await postIncoming({ toE164: aiOpenChan.phoneE164 });
    expect("ai_receptionist (in-hours) returns 200", r.status === 200, `got ${r.status}`);
    expect(
      "ai_receptionist (in-hours) returns <Gather> to /voice/gather",
      r.body.includes("<Gather") && /action="[^"]*\/api\/twilio\/voice\/gather"/.test(r.body),
      `body did not contain <Gather action=.../voice/gather>; body=${r.body.slice(0, 240)}`,
    );
  }

  // ===== Item 5 (cont) — In-hours, record_only =====
  const recOpenChan = await createChannel({
    name: "Record open",
    phoneE164: uniquePhone(),
    liveBehavior: "record_only",
    afterHoursBehavior: "hangup",
    allowVoicemail: true,
    forwardNumber: null,
    recordCalls: true,
    businessHoursClosed: false,
  });
  {
    const r = await postIncoming({ toE164: recOpenChan.phoneE164 });
    expect("record_only (in-hours) returns 200", r.status === 200, `got ${r.status}`);
    expect(
      "record_only (in-hours) returns <Record/>",
      r.body.includes("<Record "),
      `body did not contain <Record>; body=${r.body.slice(0, 240)}`,
    );
    expect(
      "record_only (in-hours) does NOT engage AI <Gather>",
      !r.body.includes("<Gather"),
      `unexpected <Gather> in body=${r.body.slice(0, 240)}`,
    );
  }

  // ===== Item 4 — After-hours: voicemail (allowed) =====
  console.log("\n\x1b[33m=== Item 4: afterHoursBehavior branches ===\x1b[0m");
  const ahVoicemailOK = await createChannel({
    name: "AH voicemail allowed",
    phoneE164: uniquePhone(),
    liveBehavior: "record_only",
    afterHoursBehavior: "voicemail",
    allowVoicemail: true,
    forwardNumber: null,
    recordCalls: true,
    businessHoursClosed: true,
  });
  {
    const r = await postIncoming({ toE164: ahVoicemailOK.phoneE164 });
    expect("after-hours voicemail (allowed) → <Record>", r.body.includes("<Record "), r.body.slice(0, 240));
  }

  const ahVoicemailDenied = await createChannel({
    name: "AH voicemail denied",
    phoneE164: uniquePhone(),
    liveBehavior: "record_only",
    afterHoursBehavior: "voicemail",
    allowVoicemail: false,
    forwardNumber: null,
    recordCalls: true,
    businessHoursClosed: true,
  });
  {
    const r = await postIncoming({ toE164: ahVoicemailDenied.phoneE164 });
    expect(
      "after-hours voicemail (allowVoicemail=false) → <Hangup>, no <Record>",
      r.body.includes("<Hangup/>") && !r.body.includes("<Record "),
      r.body.slice(0, 240),
    );
  }

  const ahForwardOK = await createChannel({
    name: "AH forward",
    phoneE164: uniquePhone(),
    liveBehavior: "record_only",
    afterHoursBehavior: "forward",
    allowVoicemail: true,
    forwardNumber: "+15555550199",
    recordCalls: true,
    businessHoursClosed: true,
  });
  {
    const r = await postIncoming({ toE164: ahForwardOK.phoneE164 });
    expect(
      "after-hours forward → <Dial>+15555550199",
      r.body.includes("<Dial") && r.body.includes("+15555550199"),
      r.body.slice(0, 240),
    );
  }

  const ahForwardMissing = await createChannel({
    name: "AH forward no number",
    phoneE164: uniquePhone(),
    liveBehavior: "record_only",
    afterHoursBehavior: "forward",
    allowVoicemail: true,
    forwardNumber: null,
    recordCalls: true,
    businessHoursClosed: true,
  });
  {
    const r = await postIncoming({ toE164: ahForwardMissing.phoneE164 });
    expect(
      "after-hours forward without forwardNumber → degrades to <Record> (allowVoicemail=true)",
      r.body.includes("<Record "),
      r.body.slice(0, 240),
    );
  }

  const ahHangup = await createChannel({
    name: "AH hangup",
    phoneE164: uniquePhone(),
    liveBehavior: "record_only",
    afterHoursBehavior: "hangup",
    allowVoicemail: true,
    forwardNumber: null,
    recordCalls: true,
    businessHoursClosed: true,
  });
  {
    const r = await postIncoming({ toE164: ahHangup.phoneE164 });
    expect(
      "after-hours hangup → <Hangup/>",
      r.body.includes("<Hangup/>") && !r.body.includes("<Record "),
      r.body.slice(0, 240),
    );
  }

  // ===== Item 5/4 — ai_after_hours_intake only engages AI after hours =====
  console.log(
    "\n\x1b[33m=== ai_after_hours_intake only engages AI after hours ===\x1b[0m",
  );
  const aiAhOpen = await createChannel({
    name: "AI after-hours intake (open now)",
    phoneE164: uniquePhone(),
    liveBehavior: "ai_after_hours_intake",
    afterHoursBehavior: "voicemail",
    allowVoicemail: true,
    forwardNumber: null,
    recordCalls: true,
    businessHoursClosed: false,
    receptionistProfileId: profileId,
  });
  {
    const r = await postIncoming({ toE164: aiAhOpen.phoneE164 });
    expect(
      "ai_after_hours_intake (in-hours) does NOT engage AI <Gather>",
      !r.body.includes("<Gather"),
      r.body.slice(0, 240),
    );
  }
  const aiAhClosed = await createChannel({
    name: "AI after-hours intake (closed now)",
    phoneE164: uniquePhone(),
    liveBehavior: "ai_after_hours_intake",
    afterHoursBehavior: "voicemail",
    allowVoicemail: true,
    forwardNumber: null,
    recordCalls: true,
    businessHoursClosed: true,
    receptionistProfileId: profileId,
  });
  {
    const r = await postIncoming({ toE164: aiAhClosed.phoneE164 });
    expect(
      "ai_after_hours_intake (after-hours) DOES engage AI <Gather>",
      r.body.includes("<Gather") && /action="[^"]*\/api\/twilio\/voice\/gather"/.test(r.body),
      r.body.slice(0, 240),
    );
  }

  // ===== Item 6 — Recording-consent gate =====
  console.log("\n\x1b[33m=== Item 6: consent gate before recording ===\x1b[0m");
  const consentChan = await createChannel({
    name: "Consent gate",
    phoneE164: uniquePhone(),
    liveBehavior: "record_only",
    afterHoursBehavior: "voicemail",
    allowVoicemail: true,
    forwardNumber: null,
    recordCalls: true,
    businessHoursClosed: false,
    consentGate: true,
  });
  const consentCallSid = `CAgate-consent-${RUN_ID}`;
  {
    const r = await postIncoming({
      toE164: consentChan.phoneE164,
      callSid: consentCallSid,
    });
    expect("consent gate returns 200", r.status === 200, `got ${r.status}`);
    expect(
      "consent gate returns <Gather> to /voice/consent (NOT /voice/gather)",
      r.body.includes("<Gather") &&
        /action="[^"]*\/api\/twilio\/voice\/consent"/.test(r.body),
      `body did not contain <Gather action=.../voice/consent>; body=${r.body.slice(0, 320)}`,
    );
    expect(
      "consent gate does NOT start <Record> before consent",
      !r.body.includes("<Record "),
      `unexpected <Record> in body=${r.body.slice(0, 320)}`,
    );
    expect(
      "consent gate does NOT speak the standard greeting before consent",
      !r.body.includes("Gate test greeting."),
      `greeting leaked into pre-consent TwiML; body=${r.body.slice(0, 320)}`,
    );
  }
  {
    const r = await postConsent({
      toE164: consentChan.phoneE164,
      digits: "1",
      callSid: consentCallSid,
    });
    expect("consent accepted (Digits=1) returns 200", r.status === 200, `got ${r.status}`);
    expect(
      "consent accepted re-enters main flow (<Record> for record_only channel)",
      r.body.includes("<Record "),
      `body=${r.body.slice(0, 320)}`,
    );
    const ev = await db
      .select()
      .from(telephonyEventsTable)
      .where(
        and(
          eq(telephonyEventsTable.userId, TEST_USER),
          eq(telephonyEventsTable.eventType, "consent:accepted"),
        ),
      );
    expect(
      "consent:accepted telephony_event row written",
      ev.length >= 1,
      `expected ≥1 row, got ${ev.length}`,
    );
  }
  {
    const declineSid = `${consentCallSid}-decline`;
    // Replay the consent gate to get a fresh CallSid scenario.
    await postIncoming({ toE164: consentChan.phoneE164, callSid: declineSid });
    const r = await postConsent({
      toE164: consentChan.phoneE164,
      digits: "2",
      callSid: declineSid,
    });
    expect(
      "consent declined (Digits=2) → <Hangup/> with no <Record>",
      r.body.includes("<Hangup/>") && !r.body.includes("<Record "),
      r.body.slice(0, 320),
    );
    const ev = await db
      .select()
      .from(telephonyEventsTable)
      .where(
        and(
          eq(telephonyEventsTable.userId, TEST_USER),
          eq(telephonyEventsTable.eventType, "consent:declined"),
        ),
      );
    expect(
      "consent:declined telephony_event row written",
      ev.length >= 1,
      `expected ≥1 row, got ${ev.length}`,
    );
  }
  {
    const noRespSid = `${consentCallSid}-noresp`;
    await postIncoming({ toE164: consentChan.phoneE164, callSid: noRespSid });
    const r = await postConsent({
      toE164: consentChan.phoneE164,
      digits: "",
      callSid: noRespSid,
    });
    expect(
      "consent no-response (Digits='') → <Hangup/> + telephony_events row",
      r.body.includes("<Hangup/>") && !r.body.includes("<Record "),
      r.body.slice(0, 320),
    );
    const ev = await db
      .select()
      .from(telephonyEventsTable)
      .where(
        and(
          eq(telephonyEventsTable.userId, TEST_USER),
          eq(telephonyEventsTable.eventType, "consent:no_response"),
        ),
      );
    expect(
      "consent:no_response telephony_event row written",
      ev.length >= 1,
      `expected ≥1 row, got ${ev.length}`,
    );
  }

  // ===== Item 9 — callerPhone preservation through pipeline =====
  console.log(
    "\n\x1b[33m=== Item 9: callerPhone preserved through pipeline ===\x1b[0m",
  );
  // First we verify the SAME SQL pattern the pipeline uses
  //   callerPhone: sql`COALESCE(call_records.caller_phone, ${analysisGuess})`
  // works at the DB layer (cheap, deterministic). Then we run the REAL
  // `runCallPipeline` and assert end-to-end behavior.
  const fromTwilio = "+15551234567";
  const [callRow] = await db
    .insert(callRecordsTable)
    .values({
      userId: TEST_USER,
      originalFilename: "gate-phase3-pipeline.wav",
      fileUrl: null,
      callerPhone: fromTwilio,
      status: "incoming",
      provider: "twilio",
      providerCallSid: `CAgate-pipeline-${RUN_ID}`,
      callDirection: "inbound",
    })
    .returning({ id: callRecordsTable.id });
  const callId = callRow!.id;

  // (a) Analysis returns null (the common case for short / demo audio).
  await db
    .update(callRecordsTable)
    .set({
      callerPhone: sql`COALESCE(${callRecordsTable.callerPhone}, ${null})`,
      summary: "gate analysis pass A",
    })
    .where(eq(callRecordsTable.id, callId));
  let row = await db
    .select({ p: callRecordsTable.callerPhone })
    .from(callRecordsTable)
    .where(eq(callRecordsTable.id, callId));
  expect(
    "callerPhone preserved when analysis returns null",
    row[0]?.p === fromTwilio,
    `expected ${fromTwilio}, got ${row[0]?.p ?? "null"}`,
  );

  // (b) Analysis returns a different number — must STILL keep Twilio's.
  await db
    .update(callRecordsTable)
    .set({
      callerPhone: sql`COALESCE(${callRecordsTable.callerPhone}, ${"+15559999999"})`,
      summary: "gate analysis pass B",
    })
    .where(eq(callRecordsTable.id, callId));
  row = await db
    .select({ p: callRecordsTable.callerPhone })
    .from(callRecordsTable)
    .where(eq(callRecordsTable.id, callId));
  expect(
    "callerPhone NOT clobbered by analysis best-guess (non-null)",
    row[0]?.p === fromTwilio,
    `expected ${fromTwilio}, got ${row[0]?.p ?? "null"}`,
  );

  // (c) When the row starts with a NULL callerPhone, COALESCE DOES fill
  // it in from analysis — proving the COALESCE is one-way (preserves
  // existing) and not a blanket "ignore analysis" bypass.
  const [emptyCall] = await db
    .insert(callRecordsTable)
    .values({
      userId: TEST_USER,
      originalFilename: "gate-phase3-pipeline-empty.wav",
      fileUrl: null,
      callerPhone: null,
      status: "incoming",
      provider: "twilio",
      providerCallSid: `CAgate-pipeline-${RUN_ID}-empty`,
      callDirection: "inbound",
    })
    .returning({ id: callRecordsTable.id });
  await db
    .update(callRecordsTable)
    .set({
      callerPhone: sql`COALESCE(${callRecordsTable.callerPhone}, ${"+15558881111"})`,
    })
    .where(eq(callRecordsTable.id, emptyCall!.id));
  const emptyRow = await db
    .select({ p: callRecordsTable.callerPhone })
    .from(callRecordsTable)
    .where(eq(callRecordsTable.id, emptyCall!.id));
  expect(
    "callerPhone is filled from analysis when no provider value existed",
    emptyRow[0]?.p === "+15558881111",
    `expected +15558881111, got ${emptyRow[0]?.p ?? "null"}`,
  );

  // (d) END-TO-END: actually invoke runCallPipeline. With no audio buffer
  // and no OpenAI integration env, processCallAudio returns DEMO_ANALYSIS
  // whose callerPhone is "+1 415-555-0142". We seed the call_record with
  // a Twilio "From" of "+15551234567"; after the pipeline runs, the
  // Twilio number must STILL be there.
  const callPipelineMod = await importApiServer("services/callPipeline.ts");
  const [pipelineCall] = await db
    .insert(callRecordsTable)
    .values({
      userId: TEST_USER,
      originalFilename: "gate-phase3-pipeline-real.wav",
      fileUrl: null,
      callerPhone: fromTwilio,
      status: "incoming",
      provider: "twilio",
      providerCallSid: `CAgate-pipeline-real-${RUN_ID}`,
      callDirection: "inbound",
    })
    .returning({ id: callRecordsTable.id });
  await callPipelineMod.runCallPipeline({
    userId: TEST_USER,
    callId: pipelineCall!.id,
    source: { audioBuffer: null, objectPath: null },
    originalFilename: "gate-phase3-pipeline-real.wav",
  });
  const after = await db
    .select({
      p: callRecordsTable.callerPhone,
      s: callRecordsTable.status,
      isDemo: callRecordsTable.isDemo,
    })
    .from(callRecordsTable)
    .where(eq(callRecordsTable.id, pipelineCall!.id));
  expect(
    "runCallPipeline preserves Twilio 'From' callerPhone end-to-end (demo analysis tries +1 415-555-0142, must NOT clobber)",
    after[0]?.p === fromTwilio,
    `expected ${fromTwilio}, got ${after[0]?.p ?? "null"}; status=${after[0]?.s}; isDemo=${after[0]?.isDemo}`,
  );
  expect(
    "runCallPipeline drove the call to status=ready",
    after[0]?.s === "ready",
    `expected ready, got ${after[0]?.s}`,
  );

  // (e) END-TO-END: same pipeline, but starting with NULL provider phone.
  // We expect the demo analysis's callerPhone to populate.
  const [pipelineCallNoPhone] = await db
    .insert(callRecordsTable)
    .values({
      userId: TEST_USER,
      originalFilename: "gate-phase3-pipeline-real-empty.wav",
      fileUrl: null,
      callerPhone: null,
      status: "incoming",
      provider: "twilio",
      providerCallSid: `CAgate-pipeline-real-empty-${RUN_ID}`,
      callDirection: "inbound",
    })
    .returning({ id: callRecordsTable.id });
  await callPipelineMod.runCallPipeline({
    userId: TEST_USER,
    callId: pipelineCallNoPhone!.id,
    source: { audioBuffer: null, objectPath: null },
    originalFilename: "gate-phase3-pipeline-real-empty.wav",
  });
  const afterEmpty = await db
    .select({ p: callRecordsTable.callerPhone })
    .from(callRecordsTable)
    .where(eq(callRecordsTable.id, pipelineCallNoPhone!.id));
  expect(
    "runCallPipeline populates callerPhone from analysis when row started NULL (one-way COALESCE)",
    afterEmpty[0]?.p != null && afterEmpty[0]?.p !== fromTwilio,
    `expected non-null and not the Twilio number, got ${afterEmpty[0]?.p ?? "null"}`,
  );

  // ===== Item 8 — switchboard transfer degrades honestly =====
  console.log(
    "\n\x1b[33m=== Item 8: switchboard transfer degrades honestly ===\x1b[0m",
  );
  // Two angles:
  //  (i) The auth gate is enforced (smoke already covers 401, re-confirm).
  // (ii) The redirect helper logic returns logged_no_provider when
  //      Twilio is not configured. We verify by replicating the helper's
  //      decision tree against the live env (no TWILIO_AUTH_TOKEN set in
  //      this dev environment), ensuring the CODE PATH the route takes
  //      is the explicit-degrade path, not a silent success.
  const transferAuthRes = await fetch(`${BASE}/api/live-sessions/${randomUUID()}/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId: randomUUID() }),
  });
  expect(
    "transfer endpoint requires auth (401 without Clerk session)",
    transferAuthRes.status === 401,
    `got ${transferAuthRes.status}`,
  );

  // END-TO-END: directly invoke redirectLiveCallToDial against the live
  // env. In dev (no TWILIO_AUTH_TOKEN) we expect the explicit honest-
  // failure status `logged_no_provider`; we also exercise the two earlier
  // guard branches (no_call_sid, no_target_phone) to prove the helper
  // returns structured errors instead of silently no-op'ing.
  const twilioControlMod = await importApiServer("services/twilioControl.ts");

  const noSid = await twilioControlMod.redirectLiveCallToDial({
    callSid: null,
    targetPhoneE164: "+15555550199",
  });
  expect(
    "redirectLiveCallToDial({callSid:null}) → status='no_call_sid', ok=false",
    noSid.ok === false && noSid.status === "no_call_sid",
    `got ${JSON.stringify(noSid)}`,
  );

  const noTarget = await twilioControlMod.redirectLiveCallToDial({
    callSid: "CAgate-fake-sid",
    targetPhoneE164: null,
  });
  expect(
    "redirectLiveCallToDial({targetPhoneE164:null}) → status='no_target_phone', ok=false",
    noTarget.ok === false && noTarget.status === "no_target_phone",
    `got ${JSON.stringify(noTarget)}`,
  );

  const hasTwilioCfg = Boolean(
    process.env["TWILIO_ACCOUNT_SID"] && process.env["TWILIO_AUTH_TOKEN"],
  );
  const noProvider = await twilioControlMod.redirectLiveCallToDial({
    callSid: "CAgate-fake-sid",
    targetPhoneE164: "+15555550199",
    sayText: "Connecting you now.",
    recordCalls: false,
  });
  if (hasTwilioCfg) {
    // Real Twilio creds are present; the call SID is fake so Twilio will
    // 4xx. The honest path here is `failed` (not silent success), with a
    // populated `twilioStatus`. That is still an honest-degrade outcome.
    expect(
      "redirectLiveCallToDial with creds + bogus SID returns honest failure (not silent success)",
      noProvider.ok === false &&
        (noProvider.status === "failed" || noProvider.status === "redirected"),
      `expected failed/redirected, got ${JSON.stringify(noProvider)}`,
    );
  } else {
    expect(
      "redirectLiveCallToDial without creds → status='logged_no_provider', ok=false (honest unsupported)",
      noProvider.ok === false && noProvider.status === "logged_no_provider",
      `got ${JSON.stringify(noProvider)}`,
    );
  }

  // The redirect-status → transfer_logs.status mapping is what the route
  // persists; verify it agrees with the spec.
  expect(
    "redirectStatusToTransferLog('logged_no_provider') === 'failed'",
    twilioControlMod.redirectStatusToTransferLog("logged_no_provider") === "failed",
    "mapping disagrees with the documented audit-trail contract",
  );
  expect(
    "redirectStatusToTransferLog('redirected') === 'bridged'",
    twilioControlMod.redirectStatusToTransferLog("redirected") === "bridged",
    "mapping disagrees with the documented audit-trail contract",
  );

  // ===== Telephony events sanity =====
  console.log("\n\x1b[33m=== Telephony events recorded ===\x1b[0m");
  const evRows = await db
    .select({ t: telephonyEventsTable.eventType })
    .from(telephonyEventsTable)
    .where(eq(telephonyEventsTable.userId, TEST_USER));
  const types = new Set(evRows.map((r) => r.t));
  for (const expected of [
    "incoming",
    "after_hours:voicemail",
    "after_hours:forward",
    "after_hours:hangup",
    "consent:accepted",
    "consent:declined",
    "consent:no_response",
  ]) {
    expect(`telephony_events contains '${expected}'`, types.has(expected), `present types: ${[...types].join(", ")}`);
  }

  // Suppress unused warning on like()
  void like;
}

(async () => {
  try {
    await runGate();
  } catch (err) {
    bad("gate harness crashed", err instanceof Error ? err.stack ?? err.message : String(err));
  } finally {
    try {
      await cleanup();
    } catch (err) {
      console.warn("cleanup failed:", err);
    }
    await pool.end();
    console.log(
      `\nGate result: \x1b[32m${pass} passed\x1b[0m, ${fail > 0 ? "\x1b[31m" : ""}${fail} failed\x1b[0m`,
    );
    if (fail > 0) {
      console.log("\nFailures:");
      for (const f of failures) console.log(` - ${f}`);
      process.exit(1);
    }
    process.exit(0);
  }
})();
