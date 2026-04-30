import { Readable } from "stream";
import { logger } from "../lib/logger";

const HAS_OPENAI =
  Boolean(process.env["AI_INTEGRATIONS_OPENAI_API_KEY"]) &&
  Boolean(process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]);

export interface CallAnalysis {
  summary: string;
  customerName: string | null;
  companyName: string | null;
  callerPhone: string | null;
  callType: string | null;
  intent: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  sentiment: "positive" | "neutral" | "negative" | "mixed";
  keyPoints: string[];
  followUpMessage: string | null;
  internalNotes: string | null;
  suggestedTags: string[];
  crmJson: Record<string, unknown>;
  actionItems: Array<{
    title: string;
    description?: string | null;
    priority: "low" | "medium" | "high";
    dueDate?: string | null;
  }>;
}

export interface ProcessedCall {
  transcriptText: string;
  durationSeconds: number | null;
  analysis: CallAnalysis;
  isDemo: boolean;
}

const DEMO_TRANSCRIPT = `Agent: Thank you for calling Apex Support, this is Marcus, how can I help you today?
Caller: Hi Marcus, this is Jordan Lee from Northside Dental. Our practice management server has been crashing for the past two days and we're losing appointment data.
Agent: I'm sorry to hear that, Jordan. Can you tell me roughly when it started?
Caller: Tuesday afternoon, around two o'clock. We've already lost three appointments and our office manager is panicking.
Agent: Understood. Let me pull up your account. I see you're on the Business plan. I can have a senior tech remote in within the hour and we'll do a full database integrity check.
Caller: That would be huge. Also, can someone follow up about upgrading our backup retention? We never want to be in this spot again.
Agent: Absolutely. I'll create a ticket for both items right now and our account manager Priya will reach out tomorrow with a quote.
Caller: Perfect, thanks Marcus. My direct line is 415-555-0142.
Agent: Got it. You'll get a confirmation email in about five minutes.`;

const DEMO_ANALYSIS: CallAnalysis = {
  summary:
    "Jordan Lee from Northside Dental called to report that their practice-management server has been crashing intermittently since Tuesday afternoon, causing lost appointment data and elevated stress for the office manager. The agent committed to dispatching a senior technician within the hour for a database integrity check, and to having an account manager follow up about expanding backup retention.",
  customerName: "Jordan Lee",
  companyName: "Northside Dental",
  callerPhone: "+1 415-555-0142",
  callType: "support",
  intent: "Restore crashing server and prevent future data loss",
  priority: "high",
  sentiment: "mixed",
  keyPoints: [
    "Practice-management server crashing since Tuesday afternoon",
    "Three appointments already lost; office manager stressed",
    "Customer on Business plan",
    "Caller asked about expanding backup retention",
  ],
  followUpMessage:
    "Hi Jordan — confirming that our senior tech is engaged on the server issue and Priya will reach out tomorrow with a backup-retention quote. We'll keep you posted as we work through the integrity check. — CallCommand",
  internalNotes:
    "Hot account. Office manager is the squeaky wheel; loop her into status updates. Backup-retention upsell is warm.",
  suggestedTags: ["support", "outage", "urgent", "upsell-opportunity", "msp"],
  crmJson: {
    contact: {
      name: "Jordan Lee",
      company: "Northside Dental",
      phone: "+1 415-555-0142",
    },
    incident: { severity: "high", category: "server-crash" },
    nextSteps: ["dispatch-tech", "schedule-account-manager-callback"],
  },
  actionItems: [
    {
      title: "Dispatch senior tech for database integrity check",
      description:
        "Remote in within the hour and run full integrity scan on Northside Dental's practice-management database.",
      priority: "high",
    },
    {
      title: "Account manager follow-up on backup-retention upgrade",
      description:
        "Priya to call Jordan tomorrow with quote for expanded backup retention.",
      priority: "medium",
    },
    {
      title: "Send confirmation email summarizing remediation plan",
      priority: "low",
    },
  ],
};

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callOpenAI<T>(args: {
  url: string;
  body: string | FormData;
  headers?: Record<string, string>;
  expectJson?: boolean;
}): Promise<T> {
  const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"]!;
  const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]!;
  const res = await fetch(`${baseUrl}${args.url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(args.headers || {}),
    },
    body: args.body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `OpenAI ${args.url} ${res.status}: ${text.slice(0, 400)}`,
    );
  }
  return (args.expectJson === false ? res : await res.json()) as T;
}

async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
): Promise<{ text: string; duration: number | null }> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], {
    type: "application/octet-stream",
  });
  form.append("file", blob, filename || "audio.wav");
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("response_format", "json");

  const json = await callOpenAI<{ text?: string; duration?: number }>({
    url: "/audio/transcriptions",
    body: form,
  });
  return { text: json.text ?? "", duration: json.duration ?? null };
}

async function analyzeTranscript(transcript: string): Promise<CallAnalysis> {
  const system = `You are CallCommand, an analyst who turns inbound phone-call transcripts into structured intelligence for sales and support operators. Return ONLY valid JSON matching the requested schema. Be specific, decisive, and concise. Never use emojis.`;
  const user = `Analyze the following call transcript and return JSON with this exact shape:

{
  "summary": string,                       // 2-4 crisp sentences
  "customerName": string | null,
  "companyName": string | null,
  "callerPhone": string | null,
  "callType": "sales" | "support" | "complaint" | "inquiry" | "follow-up" | "other",
  "intent": string | null,                 // 1 sentence on what the caller wants
  "priority": "low" | "medium" | "high" | "urgent",
  "sentiment": "positive" | "neutral" | "negative" | "mixed",
  "keyPoints": string[],                   // 3-6 short bullets
  "followUpMessage": string | null,        // a short message the rep can send the customer
  "internalNotes": string | null,          // private rep notes
  "suggestedTags": string[],               // 3-6 short kebab-case tags
  "crmJson": object,                       // any structured CRM-friendly payload you want
  "actionItems": Array<{
    "title": string,
    "description": string | null,
    "priority": "low" | "medium" | "high"
  }>                                        // 1-5 items
}

Transcript:
"""
${transcript}
"""`;

  const messages: OpenAIChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const json = await callOpenAI<{
    choices: Array<{ message: { content: string } }>;
  }>({
    url: "/chat/completions",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.4",
      messages,
      response_format: { type: "json_object" },
    }),
  });
  const content = json.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Partial<CallAnalysis>;
  return normalizeAnalysis(parsed);
}

function normalizeAnalysis(p: Partial<CallAnalysis>): CallAnalysis {
  const allowedPriority = new Set(["low", "medium", "high", "urgent"]);
  const allowedSentiment = new Set([
    "positive",
    "neutral",
    "negative",
    "mixed",
  ]);
  const priority = allowedPriority.has(String(p.priority ?? ""))
    ? (p.priority as CallAnalysis["priority"])
    : "medium";
  const sentiment = allowedSentiment.has(String(p.sentiment ?? ""))
    ? (p.sentiment as CallAnalysis["sentiment"])
    : "neutral";
  return {
    summary: String(p.summary ?? "").trim() || "No summary available.",
    customerName: p.customerName ?? null,
    companyName: p.companyName ?? null,
    callerPhone: p.callerPhone ?? null,
    callType: p.callType ?? null,
    intent: p.intent ?? null,
    priority,
    sentiment,
    keyPoints: Array.isArray(p.keyPoints)
      ? p.keyPoints.map((s) => String(s)).slice(0, 8)
      : [],
    followUpMessage: p.followUpMessage ?? null,
    internalNotes: p.internalNotes ?? null,
    suggestedTags: Array.isArray(p.suggestedTags)
      ? p.suggestedTags.map((s) => String(s)).slice(0, 8)
      : [],
    crmJson: (p.crmJson as Record<string, unknown>) ?? {},
    actionItems: Array.isArray(p.actionItems)
      ? p.actionItems.slice(0, 6).map((a) => ({
          title: String(a.title ?? "Action").slice(0, 200),
          description: a.description ?? null,
          priority:
            a.priority === "high" || a.priority === "low" ? a.priority : "medium",
          dueDate: a.dueDate ?? null,
        }))
      : [],
  };
}

export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function processCallAudio(args: {
  audioBuffer: Buffer | null;
  originalFilename: string;
}): Promise<ProcessedCall> {
  if (!HAS_OPENAI || !args.audioBuffer || args.audioBuffer.length === 0) {
    return {
      transcriptText: DEMO_TRANSCRIPT,
      durationSeconds: 92,
      analysis: DEMO_ANALYSIS,
      isDemo: true,
    };
  }

  try {
    const { text, duration } = await transcribeAudio(
      args.audioBuffer,
      args.originalFilename,
    );
    if (!text || text.trim().length < 10) {
      logger.warn(
        { filename: args.originalFilename },
        "Transcript too short, falling back to demo",
      );
      return {
        transcriptText: DEMO_TRANSCRIPT,
        durationSeconds: 92,
        analysis: DEMO_ANALYSIS,
        isDemo: true,
      };
    }
    const analysis = await analyzeTranscript(text);
    return {
      transcriptText: text,
      durationSeconds: duration != null ? Math.round(duration) : null,
      analysis,
      isDemo: false,
    };
  } catch (err) {
    logger.error({ err }, "OpenAI processing failed; using demo fallback");
    return {
      transcriptText: DEMO_TRANSCRIPT,
      durationSeconds: 92,
      analysis: DEMO_ANALYSIS,
      isDemo: true,
    };
  }
}
