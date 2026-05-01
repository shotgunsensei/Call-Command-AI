import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  callRecordsTable,
  actionItemsTable,
  integrationsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import {
  CreateCallBody,
  ListCallsQueryParams,
  SendCallWebhookBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { claimUploadIntent } from "@workspace/db";
import { streamCallPdf } from "../services/pdf";
import { getPlanInfo } from "../lib/plans";
import { safeFetchWebhook } from "../lib/safeWebhook";
import { runRulesWithDefaults } from "../services/rulesEngine";
import { runCallPipeline } from "../services/callPipeline";
import { twilioProvider } from "../services/telephony/twilioProvider";

const router: IRouter = Router();
const storage = new ObjectStorageService();

function serializeCall(
  call: typeof callRecordsTable.$inferSelect,
  actionItems: Array<typeof actionItemsTable.$inferSelect>,
): Record<string, unknown> {
  return {
    id: call.id,
    userId: call.userId,
    originalFilename: call.originalFilename,
    fileUrl: call.fileUrl,
    transcriptText: call.transcriptText,
    summary: call.summary,
    customerName: call.customerName,
    companyName: call.companyName,
    callerPhone: call.callerPhone,
    callType: call.callType,
    intent: call.intent,
    priority: call.priority,
    sentiment: call.sentiment,
    status: call.status,
    durationSeconds: call.durationSeconds,
    keyPoints: call.keyPoints ?? [],
    followUpMessage: call.followUpMessage,
    internalNotes: call.internalNotes,
    crmJson: call.crmJson,
    suggestedTags: call.suggestedTags ?? [],
    isDemo: call.isDemo ?? "false",
    errorMessage: call.errorMessage,
    channelId: call.channelId,
    assignedUserId: call.assignedUserId,
    createdAt: call.createdAt.toISOString(),
    updatedAt: call.updatedAt.toISOString(),
    actionItems: actionItems.map((ai) => ({
      id: ai.id,
      callRecordId: ai.callRecordId,
      title: ai.title,
      description: ai.description,
      dueDate: ai.dueDate ? ai.dueDate.toISOString() : null,
      priority: ai.priority,
      status: ai.status,
      createdAt: ai.createdAt.toISOString(),
      updatedAt: ai.updatedAt.toISOString(),
    })),
  };
}

async function loadCallWithItems(
  userId: string,
  id: string,
): Promise<{
  call: typeof callRecordsTable.$inferSelect;
  items: Array<typeof actionItemsTable.$inferSelect>;
} | null> {
  const [call] = await db
    .select()
    .from(callRecordsTable)
    .where(
      and(eq(callRecordsTable.id, id), eq(callRecordsTable.userId, userId)),
    )
    .limit(1);
  if (!call) return null;
  const items = await db
    .select()
    .from(actionItemsTable)
    .where(eq(actionItemsTable.callRecordId, call.id))
    .orderBy(asc(actionItemsTable.createdAt));
  return { call, items };
}

async function runProcessing(
  userId: string,
  callId: string,
  objectPath: string | null,
  originalFilename: string,
): Promise<void> {
  // Thin wrapper around the canonical pipeline so legacy upload routes
  // still have a single function to call.
  await runCallPipeline({
    userId,
    callId,
    source: { objectPath },
    originalFilename,
  });
}

router.get(
  "/calls",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const parsed = ListCallsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    const { q, status, priority } = parsed.data;
    const conditions = [eq(callRecordsTable.userId, userId)];
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      const orExpr = or(
        ilike(callRecordsTable.originalFilename, like),
        ilike(callRecordsTable.summary, like),
        ilike(callRecordsTable.customerName, like),
        ilike(callRecordsTable.companyName, like),
        ilike(callRecordsTable.transcriptText, like),
      );
      if (orExpr) conditions.push(orExpr);
    }
    if (status) conditions.push(eq(callRecordsTable.status, status));
    if (priority) conditions.push(eq(callRecordsTable.priority, priority));

    const calls = await db
      .select()
      .from(callRecordsTable)
      .where(and(...conditions))
      .orderBy(desc(callRecordsTable.createdAt))
      .limit(200);

    const ids = calls.map((c) => c.id);
    const items = ids.length
      ? await db
          .select()
          .from(actionItemsTable)
          .where(
            sql`${actionItemsTable.callRecordId} = ANY(${ids}::uuid[])`,
          )
      : [];
    const byCall = new Map<string, Array<typeof items[number]>>();
    for (const it of items) {
      const arr = byCall.get(it.callRecordId) ?? [];
      arr.push(it);
      byCall.set(it.callRecordId, arr);
    }

    res.json(calls.map((c) => serializeCall(c, byCall.get(c.id) ?? [])));
  },
);

router.post(
  "/calls",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const parsed = CreateCallBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    // Plan limit check
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (user) {
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
        res.status(402).json({
          error: `Monthly call limit reached for plan "${plan.name}" (${plan.monthlyLimit}). Upgrade to process more calls.`,
        });
        return;
      }
    }

    const objectPath = storage.normalizeObjectEntityPath(
      parsed.data.objectPath,
    );
    // Object paths must point inside our private uploads namespace. The
    // upload IDs are random UUIDs issued by getObjectEntityUploadURL().
    if (!/^\/objects\/uploads\/[a-zA-Z0-9-]{8,}$/.test(objectPath)) {
      res.status(400).json({ error: "Invalid object path" });
      return;
    }

    // Atomically claim the upload intent and insert the call record in a
    // single transaction. Concurrent attach attempts for the same
    // object_path race on the conditional UPDATE inside `claimUploadIntent`
    // — only one wins. If the call_records insert fails (or the process
    // crashes mid-transaction) the claim is rolled back automatically.
    type AttachOk = { kind: "ok"; call: typeof callRecordsTable.$inferSelect };
    type AttachFail = {
      kind: "fail";
      reason: "missing_or_wrong_owner" | "expired" | "already_attached";
    };
    const attached: AttachOk | AttachFail = await db.transaction(async (tx) => {
      const claim = await claimUploadIntent({
        userId,
        objectPath,
        executor: tx,
      });
      if (!claim.ok) {
        return { kind: "fail", reason: claim.reason };
      }
      const [row] = await tx
        .insert(callRecordsTable)
        .values({
          userId,
          originalFilename: parsed.data.originalFilename,
          fileUrl: objectPath,
          status: "processing",
          keyPoints: [],
          suggestedTags: [],
        })
        .returning();
      if (!row) {
        // Force a rollback so the claim doesn't persist.
        throw new Error("call_records insert returned no row");
      }
      return { kind: "ok", call: row };
    });

    if (attached.kind === "fail") {
      const status =
        attached.reason === "missing_or_wrong_owner"
          ? 403
          : attached.reason === "expired"
            ? 410
            : 409;
      const message =
        attached.reason === "missing_or_wrong_owner"
          ? "Upload not authorized for this user"
          : attached.reason === "expired"
            ? "Upload intent expired"
            : "Upload already attached to a call";
      res.status(status).json({ error: message });
      return;
    }
    const call = attached.call;

    // Process inline (small audio files in this app); errors are caught and
    // surfaced via demo fallback inside processCallAudio.
    try {
      await runProcessing(userId, call.id, objectPath, call.originalFilename);
    } catch (err) {
      req.log.error({ err }, "Processing failed");
      await db
        .update(callRecordsTable)
        .set({
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        })
        .where(eq(callRecordsTable.id, call.id));
    }

    const out = await loadCallWithItems(userId, call.id);
    res.status(201).json(serializeCall(out!.call, out!.items));
  },
);

router.get(
  "/calls/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const out = await loadCallWithItems(userId, id);
    if (!out) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    res.json(serializeCall(out.call, out.items));
  },
);

router.delete(
  "/calls/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const [call] = await db
      .select()
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.id, id),
          eq(callRecordsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!call) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .delete(actionItemsTable)
      .where(eq(actionItemsTable.callRecordId, call.id));
    await db
      .delete(callRecordsTable)
      .where(eq(callRecordsTable.id, call.id));
    res.status(204).end();
  },
);

router.post(
  "/calls/:id/process",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const [call] = await db
      .select()
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.id, id),
          eq(callRecordsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!call) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .update(callRecordsTable)
      .set({ status: "processing", errorMessage: null })
      .where(eq(callRecordsTable.id, call.id));
    try {
      await runProcessing(userId, call.id, call.fileUrl, call.originalFilename);
    } catch (err) {
      req.log.error({ err }, "Reprocess failed");
      await db
        .update(callRecordsTable)
        .set({
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        })
        .where(eq(callRecordsTable.id, call.id));
    }
    const out = await loadCallWithItems(userId, call.id);
    res.json(serializeCall(out!.call, out!.items));
  },
);

// Re-runs the analysis pipeline against an existing call. Prefers the
// Twilio recording URL (re-downloaded with auth) and falls back to the
// stored fileUrl. Status is reset to "processing" up front so the UI
// reflects activity immediately.
router.post(
  "/calls/:id/retry-processing",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const [call] = await db
      .select()
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.id, id),
          eq(callRecordsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!call) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await db
      .update(callRecordsTable)
      .set({ status: "processing", errorMessage: null })
      .where(eq(callRecordsTable.id, call.id));
    try {
      let audioBuffer: Buffer | null = null;
      if (call.provider === "twilio" && call.recordingUrl) {
        audioBuffer = await twilioProvider.downloadRecording(call.recordingUrl);
      }
      await runCallPipeline({
        userId,
        callId: call.id,
        source: audioBuffer ? { audioBuffer } : { objectPath: call.fileUrl },
        originalFilename: call.originalFilename,
      });
    } catch (err) {
      req.log.error({ err }, "retry-processing failed");
      await db
        .update(callRecordsTable)
        .set({
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Unknown error",
        })
        .where(eq(callRecordsTable.id, call.id));
    }
    const out = await loadCallWithItems(userId, call.id);
    res.json(serializeCall(out!.call, out!.items));
  },
);

router.post(
  "/calls/:id/webhook",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const parsed = SendCallWebhookBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const [integration] = await db
      .select()
      .from(integrationsTable)
      .where(
        and(
          eq(integrationsTable.id, parsed.data.integrationId),
          eq(integrationsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    if (!integration.enabled) {
      res
        .status(400)
        .json({ ok: false, status: null, message: "Integration is disabled" });
      return;
    }
    const callId = String(req.params["id"]);
    const out = await loadCallWithItems(userId, callId);
    if (!out) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    const payload = serializeCall(out.call, out.items);
    try {
      const response = await safeFetchWebhook(integration.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "callcommand",
          integration: { id: integration.id, type: integration.type },
          call: payload,
        }),
      });
      res.json({
        ok: response.ok,
        status: response.status,
        message: response.ok
          ? "Delivered"
          : `Webhook responded ${response.status}`,
      });
    } catch (err) {
      res.json({
        ok: false,
        status: null,
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  },
);

router.post(
  "/calls/:id/run-rules",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const [call] = await db
      .select()
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.id, id),
          eq(callRecordsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!call) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    const result = await runRulesWithDefaults({ userId, call });
    res.json(result);
  },
);

router.get(
  "/calls/:id/pdf",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const out = await loadCallWithItems(userId, id);
    if (!out) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    streamCallPdf(res, out.call, out.items);
  },
);

export default router;
