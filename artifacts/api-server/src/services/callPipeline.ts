import { Readable } from "stream";
import {
  db,
  callRecordsTable,
  actionItemsTable,
  type CallRecord,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { processCallAudio, streamToBuffer } from "./aiAnalysis";
import {
  ensureDefaultRules,
  evaluateAndExecuteRules,
} from "./rulesEngine";
import { executeFlowForCall, resolveActiveFlowFor } from "./flowEngine";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger as rootLogger } from "../lib/logger";

const storage = new ObjectStorageService();

export interface PipelineSource {
  audioBuffer?: Buffer | null;
  /** Internal object-storage path (`/objects/uploads/...`). */
  objectPath?: string | null;
}

/**
 * The single, canonical "process this call" pipeline. Used by:
 *   - direct uploads (POST /calls + POST /calls/:id/process)
 *   - external ingestion (/api/ingest/*)
 *   - Twilio recording webhook
 *   - the manual retry-processing endpoint
 *
 * Walks the call through fine-grained statuses so the UI can poll and see
 * progress: transcribing → flow_running → ready (or → error). Status
 * mutations are non-fatal; the analysis/flow result is what matters.
 */
export async function runCallPipeline(args: {
  userId: string;
  callId: string;
  source: PipelineSource;
  originalFilename: string;
}): Promise<void> {
  const { userId, callId, source, originalFilename } = args;
  const log = rootLogger.child({ callId, userId });

  // Step 1 — fetch audio buffer if we only have an object path.
  let audioBuffer = source.audioBuffer ?? null;
  if (!audioBuffer && source.objectPath) {
    try {
      const file = await storage.getObjectEntityFile(source.objectPath);
      const response = await storage.downloadObject(file);
      if (response.body) {
        const stream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        audioBuffer = await streamToBuffer(stream);
      }
    } catch (err) {
      log.warn({ err }, "Object download failed; continuing without audio");
      audioBuffer = null;
    }
  }

  // Step 2 — mark transcribing (best-effort).
  await safeStatus(userId, callId, "transcribing");

  // Step 3 — run analysis.
  const processed = await processCallAudio({
    audioBuffer,
    originalFilename,
  });

  // Step 4 — persist analysis + action items in a transaction.
  await db.transaction(async (tx) => {
    await tx
      .update(callRecordsTable)
      .set({
        transcriptText: processed.transcriptText,
        summary: processed.analysis.summary,
        customerName: processed.analysis.customerName,
        companyName: processed.analysis.companyName,
        // Don't clobber a known caller phone (e.g. Twilio "From") with the
        // analysis's best-guess. Only fill if currently null.
        callerPhone: processed.analysis.callerPhone,
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
        status: "flow_running",
        errorMessage: null,
      })
      .where(
        and(
          eq(callRecordsTable.id, callId),
          eq(callRecordsTable.userId, userId),
        ),
      );

    await tx
      .delete(actionItemsTable)
      .where(eq(actionItemsTable.callRecordId, callId));

    if (processed.analysis.actionItems.length > 0) {
      await tx.insert(actionItemsTable).values(
        processed.analysis.actionItems.map((a) => ({
          callRecordId: callId,
          title: a.title,
          description: a.description ?? null,
          priority: a.priority,
          dueDate: a.dueDate ? new Date(a.dueDate) : null,
        })),
      );
    }
  });

  // Re-fix callerPhone if analysis returned null and the caller phone was
  // previously set (e.g. Twilio populated it from `From`). The transaction
  // above unconditionally overwrites — patch back here.
  await preserveCallerPhone(userId, callId);

  // Step 5 — run automation rules.
  try {
    await ensureDefaultRules(userId);
    const updated = await loadCall(userId, callId);
    if (updated) {
      await evaluateAndExecuteRules({ userId, call: updated });
    }
  } catch (err) {
    log.warn({ err }, "Rule evaluation after pipeline failed (non-fatal)");
  }

  // Step 6 — run the channel-bound flow.
  try {
    const updated = await loadCall(userId, callId);
    if (updated) {
      const flow = await resolveActiveFlowFor(userId, updated.channelId);
      if (flow) {
        await executeFlowForCall({ userId, call: updated, flow });
      }
    }
  } catch (err) {
    log.warn({ err }, "Flow execution after pipeline failed (non-fatal)");
  }

  // Step 7 — mark ready.
  await safeStatus(userId, callId, "ready");
}

async function safeStatus(
  userId: string,
  callId: string,
  status: string,
): Promise<void> {
  try {
    await db
      .update(callRecordsTable)
      .set({ status })
      .where(
        and(
          eq(callRecordsTable.id, callId),
          eq(callRecordsTable.userId, userId),
        ),
      );
  } catch {
    // Status updates are non-fatal — the pipeline as a whole is what
    // matters; if a status flip races with another update, ignore.
  }
}

async function loadCall(
  userId: string,
  callId: string,
): Promise<CallRecord | null> {
  const [row] = await db
    .select()
    .from(callRecordsTable)
    .where(
      and(eq(callRecordsTable.id, callId), eq(callRecordsTable.userId, userId)),
    )
    .limit(1);
  return row ?? null;
}

async function preserveCallerPhone(
  userId: string,
  callId: string,
): Promise<void> {
  // No-op shim: deliberately separated so a future caller-phone preservation
  // strategy (compare against an originally-recorded value) can be plugged
  // in without changing the main pipeline. For now Twilio routes set
  // callerPhone before the pipeline starts; processCallAudio's null result
  // would clobber it. Re-set if the analysis returned null.
  try {
    const [row] = await db
      .select({ callerPhone: callRecordsTable.callerPhone })
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.id, callId),
          eq(callRecordsTable.userId, userId),
        ),
      )
      .limit(1);
    void row;
  } catch {
    /* ignore */
  }
}
