import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  callRecordsTable,
  ingestionEventsTable,
  usersTable,
} from "@workspace/db";
import { eq, sql, and, gte } from "drizzle-orm";
import { requireIngestionToken } from "../middlewares/requireIngestionToken";
import { requireAuth } from "../middlewares/requireAuth";
import { processCallAudio } from "../services/aiAnalysis";
import { evaluateAndExecuteRules, ensureDefaultRules } from "../services/rulesEngine";
import {
  executeFlowForCall,
  resolveActiveFlowFor,
} from "../services/flowEngine";
import { resolveChannelForIngestion } from "./channels";
import { getPlanInfo } from "../lib/plans";
import { logger } from "../lib/logger";

const router: IRouter = Router();

interface IngestionInput {
  source: string;
  rawPayload: Record<string, unknown>;
  filename: string;
  callerPhone: string | null;
  /**
   * The inbound line that received the call (e.g. Twilio "To"). Used for
   * channel routing — distinct from `callerPhone` (the caller's number).
   */
  lineNumber: string | null;
  customerName: string | null;
  fileUrl: string | null;
}

function readString(
  obj: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function makeFilename(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}.ingested`;
}

async function checkPlanLimit(userId: string): Promise<string | null> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return "User not found";
  if (user.role === "admin") return null;
  const plan = getPlanInfo(user.plan);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(callRecordsTable)
    .where(
      and(
        eq(callRecordsTable.userId, userId),
        gte(callRecordsTable.createdAt, monthStart),
      ),
    );
  if (Number(count) >= plan.monthlyLimit) {
    return `Monthly call limit reached for plan "${plan.name}"`;
  }
  return null;
}

async function ingestAndProcess(
  userId: string,
  input: IngestionInput,
): Promise<{ callId: string; eventId: string } | { error: string; status: number; eventId?: string }> {
  const limitErr = await checkPlanLimit(userId);
  if (limitErr) {
    const [event] = await db
      .insert(ingestionEventsTable)
      .values({
        userId,
        source: input.source,
        rawPayload: input.rawPayload,
        status: "rejected",
        errorMessage: limitErr,
      })
      .returning({ id: ingestionEventsTable.id });
    return { error: limitErr, status: 402, eventId: event?.id };
  }

  // Resolve which channel this inbound call belongs to. Channel routing
  // matches on the inbound LINE number (e.g. Twilio "To"), NOT the caller
  // (Twilio "From") — multiple customers can call the same line and they
  // all share that channel's flow. Falls back to the per-user default
  // channel that we auto-seed.
  const channel = await resolveChannelForIngestion({
    userId,
    phoneNumber: input.lineNumber,
  });

  // Insert call record + ingestion event
  const [call] = await db
    .insert(callRecordsTable)
    .values({
      userId,
      originalFilename: input.filename,
      fileUrl: input.fileUrl,
      callerPhone: input.callerPhone,
      customerName: input.customerName,
      status: "processing",
      keyPoints: [],
      suggestedTags: [],
      channelId: channel.id,
    })
    .returning();

  const [event] = await db
    .insert(ingestionEventsTable)
    .values({
      userId,
      source: input.source,
      rawPayload: input.rawPayload,
      callRecordId: call!.id,
      status: "accepted",
    })
    .returning({ id: ingestionEventsTable.id });

  // Run analysis (will use demo transcript if no OpenAI configured / no audio).
  try {
    const processed = await processCallAudio({
      audioBuffer: null,
      originalFilename: input.filename,
    });
    const overrideName = input.customerName ?? processed.analysis.customerName;
    const overridePhone = input.callerPhone ?? processed.analysis.callerPhone;
    await db
      .update(callRecordsTable)
      .set({
        transcriptText: processed.transcriptText,
        summary: processed.analysis.summary,
        customerName: overrideName,
        companyName: processed.analysis.companyName,
        callerPhone: overridePhone,
        callType: processed.analysis.callType,
        intent: processed.analysis.intent,
        priority: processed.analysis.priority,
        sentiment: processed.analysis.sentiment,
        durationSeconds: processed.durationSeconds,
        keyPoints: processed.analysis.keyPoints,
        followUpMessage: processed.analysis.followUpMessage,
        internalNotes: processed.analysis.internalNotes,
        crmJson: processed.analysis.crmJson,
        suggestedTags: processed.analysis.suggestedTags,
        isDemo: processed.isDemo ? "true" : "false",
        status: "ready",
      })
      .where(eq(callRecordsTable.id, call!.id));

    const [updated] = await db
      .select()
      .from(callRecordsTable)
      .where(eq(callRecordsTable.id, call!.id))
      .limit(1);
    if (updated) {
      try {
        await ensureDefaultRules(userId);
        await evaluateAndExecuteRules({ userId, call: updated });
      } catch (err) {
        logger.warn({ err }, "Rule evaluation after ingestion failed");
      }
      // Run the channel-bound flow after rules. Failures non-fatal.
      try {
        const flow = await resolveActiveFlowFor(userId, updated.channelId);
        if (flow) {
          const [latest] = await db
            .select()
            .from(callRecordsTable)
            .where(eq(callRecordsTable.id, call!.id))
            .limit(1);
          if (latest) {
            await executeFlowForCall({ userId, call: latest, flow });
          }
        }
      } catch (err) {
        logger.warn({ err }, "Flow execution after ingestion failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "Ingestion processing failed");
    await db
      .update(callRecordsTable)
      .set({
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Unknown error",
      })
      .where(eq(callRecordsTable.id, call!.id));
  }

  return { callId: call!.id, eventId: event!.id };
}

// Twilio-style: form-encoded with `From`, `RecordingUrl`, etc.
router.post(
  "/ingest/twilio",
  requireIngestionToken,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.ingestionUserId!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await ingestAndProcess(userId, {
      source: "twilio",
      rawPayload: body,
      filename:
        readString(body, "RecordingSid") ??
        readString(body, "CallSid") ??
        makeFilename("twilio"),
      callerPhone: readString(body, "From") ?? readString(body, "Caller"),
      // Twilio "To" / "Called" is the line that *received* the call —
      // that's the channel selector. Without this we'd route by caller
      // and break multi-line orchestration entirely.
      lineNumber: readString(body, "To") ?? readString(body, "Called"),
      customerName: readString(body, "CallerName"),
      fileUrl: readString(body, "RecordingUrl"),
    });
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(202).json({ callId: result.callId, eventId: result.eventId });
  },
);

// Generic email-to-call: { from, subject, body, attachmentUrl? }
router.post(
  "/ingest/email",
  requireIngestionToken,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.ingestionUserId!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await ingestAndProcess(userId, {
      source: "email",
      rawPayload: body,
      filename:
        readString(body, "subject") ??
        readString(body, "messageId") ??
        makeFilename("email"),
      callerPhone: null,
      lineNumber: readString(body, "to"),
      customerName: readString(body, "from"),
      fileUrl: readString(body, "attachmentUrl"),
    });
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(202).json({ callId: result.callId, eventId: result.eventId });
  },
);

// Generic webhook: free-form JSON { customerName?, callerPhone?, fileUrl?, label? }
router.post(
  "/ingest/webhook",
  requireIngestionToken,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.ingestionUserId!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await ingestAndProcess(userId, {
      source: "webhook",
      rawPayload: body,
      filename: readString(body, "label") ?? makeFilename("webhook"),
      callerPhone: readString(body, "callerPhone") ?? readString(body, "phone"),
      lineNumber:
        readString(body, "lineNumber") ??
        readString(body, "to") ??
        readString(body, "channelPhone"),
      customerName:
        readString(body, "customerName") ?? readString(body, "name"),
      fileUrl: readString(body, "fileUrl") ?? readString(body, "audioUrl"),
    });
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(202).json({ callId: result.callId, eventId: result.eventId });
  },
);

// Demo simulator — uses normal Clerk auth so the in-app button works.
router.post(
  "/demo/simulate-call",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const result = await ingestAndProcess(userId, {
      source: "demo",
      rawPayload: { simulated: true, ts: Date.now() },
      filename: makeFilename("demo-call"),
      callerPhone: null,
      lineNumber: null,
      customerName: null,
      fileUrl: null,
    });
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const [call] = await db
      .select()
      .from(callRecordsTable)
      .where(eq(callRecordsTable.id, result.callId))
      .limit(1);
    res.status(201).json({
      ...call!,
      keyPoints: call!.keyPoints ?? [],
      suggestedTags: call!.suggestedTags ?? [],
      isDemo: call!.isDemo ?? "true",
      createdAt: call!.createdAt.toISOString(),
      updatedAt: call!.updatedAt.toISOString(),
      actionItems: [],
    });
  },
);

router.get(
  "/ingestion-events",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const rows = await db
      .select({
        id: ingestionEventsTable.id,
        userId: ingestionEventsTable.userId,
        source: ingestionEventsTable.source,
        callRecordId: ingestionEventsTable.callRecordId,
        status: ingestionEventsTable.status,
        errorMessage: ingestionEventsTable.errorMessage,
        createdAt: ingestionEventsTable.createdAt,
      })
      .from(ingestionEventsTable)
      .where(eq(ingestionEventsTable.userId, userId))
      .orderBy(sql`${ingestionEventsTable.createdAt} DESC`)
      .limit(200);
    res.json(
      rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  },
);

export default router;
