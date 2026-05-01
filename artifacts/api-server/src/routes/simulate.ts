import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  callRecordsTable,
  type CallRecord,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  executeFlowForCall,
  resolveActiveFlowFor,
} from "../services/flowEngine";
import {
  ensureDefaultRules,
  evaluateAndExecuteRules,
} from "../services/rulesEngine";
import { resolveChannelForIngestion } from "./channels";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Synchronous simulation: caller picks a channel + provides a transcript and
 * optional intent/priority/sentiment. We create a `call_records` row marked
 * `isDemo=true`, run the rules engine, then walk the channel-bound flow.
 * The full flow trace is returned in the response so the UI can render it
 * step-by-step without polling.
 */
router.post(
  "/simulate-call",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const transcript =
      typeof body.transcript === "string" && body.transcript.trim()
        ? body.transcript
        : "Simulated inbound call. The caller is interested in scheduling a demo next week.";
    const customerName =
      typeof body.customerName === "string" && body.customerName.trim()
        ? body.customerName
        : null;
    const callerPhone =
      typeof body.callerPhone === "string" && body.callerPhone.trim()
        ? body.callerPhone
        : null;
    // The UI passes channelId explicitly; if the caller instead sends a
    // line number we route on that, NOT on the caller phone (channels are
    // keyed off the inbound line, not who's calling in).
    const lineNumber =
      typeof body.lineNumber === "string" && body.lineNumber.trim()
        ? body.lineNumber
        : typeof body.toNumber === "string" && body.toNumber.trim()
          ? body.toNumber
          : null;
    const requestedChannelId =
      typeof body.channelId === "string" ? body.channelId : null;

    const channel = await resolveChannelForIngestion({
      userId,
      phoneNumber: lineNumber,
      preferredChannelId: requestedChannelId,
    });

    // Derive a quick keyword-based analysis so the call has fields for
    // condition nodes to act on. Caller can override.
    const lowered = transcript.toLowerCase();
    const intent =
      typeof body.intent === "string"
        ? body.intent
        : lowered.match(/cancel|refund|broken|crash|bug|error/) ? "support"
        : lowered.match(/buy|price|demo|trial|interested|quote/) ? "sales"
        : lowered.match(/schedule|appointment|book|reschedule/) ? "scheduling"
        : "general";
    const priority =
      typeof body.priority === "string"
        ? body.priority
        : lowered.match(/urgent|asap|immediately|critical/) ? "urgent"
        : lowered.match(/important|priority|today/) ? "high"
        : "medium";
    const sentiment =
      typeof body.sentiment === "string"
        ? body.sentiment
        : lowered.match(/angry|frustrated|disappointed|terrible/)
          ? "negative"
          : lowered.match(/happy|love|great|amazing|thanks/)
            ? "positive"
            : "neutral";

    const callType = intent;
    const summary = transcript.slice(0, 280);

    const [created] = await db
      .insert(callRecordsTable)
      .values({
        userId,
        originalFilename: `simulated-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
        transcriptText: transcript,
        summary,
        customerName,
        callerPhone,
        callType,
        intent,
        priority,
        sentiment,
        status: "ready",
        keyPoints: [transcript.slice(0, 120)],
        suggestedTags: [intent],
        isDemo: "true",
        channelId: channel.id,
      })
      .returning();
    const call: CallRecord = created!;

    // Run rules first (independent surface), then the channel's flow.
    try {
      await ensureDefaultRules(userId);
      await evaluateAndExecuteRules({ userId, call });
    } catch (err) {
      logger.warn({ err }, "Rule evaluation during simulation failed");
    }

    let flowResult: Awaited<ReturnType<typeof executeFlowForCall>> | null =
      null;
    const flow = await resolveActiveFlowFor(userId, channel.id);
    if (flow) {
      try {
        flowResult = await executeFlowForCall({ userId, call, flow });
      } catch (err) {
        logger.warn({ err }, "Flow execution during simulation failed");
      }
    }

    // Re-read the call so the response reflects any in-flow mutations.
    const [refreshed] = await db
      .select()
      .from(callRecordsTable)
      .where(eq(callRecordsTable.id, call.id))
      .limit(1);

    res.status(201).json({
      callId: refreshed?.id ?? call.id,
      flowId: flowResult?.flowId ?? null,
      flowName: flowResult?.flowName ?? null,
      nodesExecuted: flowResult?.nodesExecuted ?? 0,
      actionsExecuted: flowResult?.actionsExecuted ?? 0,
      endedAt: flowResult?.endedAt ?? null,
      log: (flowResult?.log ?? []).map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  },
);

export default router;
