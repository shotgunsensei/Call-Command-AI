import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { db, channelsTable, type Channel } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { normalizeE164 } from "../lib/phoneNumbers";

const router: IRouter = Router();

function serialize(c: Channel) {
  return {
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/**
 * Ensure the user has at least one channel. If not, seed a default
 * "Inbound (default)" channel of type "webhook" so every ingested call has
 * something to attach to. Idempotent.
 */
export async function ensureDefaultChannel(userId: string): Promise<Channel> {
  const existing = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.userId, userId))
    .orderBy(asc(channelsTable.createdAt))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(channelsTable)
    .values({
      userId,
      name: "Inbound (default)",
      type: "webhook",
      isActive: true,
      isDefault: true,
    })
    .returning();
  return created!;
}

/**
 * Pick the channel to attach an inbound call to. Looks up by phone first
 * (e.g. Twilio "To"), falls back to the seeded default channel.
 *
 * Phone lookup is E.164-normalized on both sides so we tolerate inputs
 * formatted as `(415) 555-0142`, `415-555-0142`, `+14155550142`, etc.
 * Channel rows store the value as-typed; we normalize at compare time so
 * legacy rows still match.
 */
export async function resolveChannelForIngestion(args: {
  userId: string;
  phoneNumber: string | null;
  preferredChannelId?: string | null;
}): Promise<Channel> {
  if (args.preferredChannelId) {
    const [c] = await db
      .select()
      .from(channelsTable)
      .where(
        and(
          eq(channelsTable.userId, args.userId),
          eq(channelsTable.id, args.preferredChannelId),
        ),
      )
      .limit(1);
    if (c) return c;
  }
  const wantedE164 = normalizeE164(args.phoneNumber);
  if (wantedE164) {
    // Pull the user's channels and compare normalized values in JS. This
    // keeps the SQL portable (no UDF for normalization) and handles the
    // small-N case here efficiently.
    const all = await db
      .select()
      .from(channelsTable)
      .where(eq(channelsTable.userId, args.userId));
    const match = all.find((c) => normalizeE164(c.phoneNumber) === wantedE164);
    if (match) return match;
  }
  return ensureDefaultChannel(args.userId);
}

/**
 * Strict variant for Twilio incoming. Returns null if no channel matches
 * and no default exists yet — Twilio handler then plays a safe TwiML
 * message rather than auto-seeding a default for a stranger.
 */
export async function findChannelByLine(args: {
  userId: string;
  phoneNumber: string | null;
}): Promise<Channel | null> {
  const wantedE164 = normalizeE164(args.phoneNumber);
  if (!wantedE164) return null;
  const all = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.userId, args.userId));
  return all.find((c) => normalizeE164(c.phoneNumber) === wantedE164) ?? null;
}

router.get(
  "/channels",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    await ensureDefaultChannel(userId);
    const rows = await db
      .select()
      .from(channelsTable)
      .where(eq(channelsTable.userId, userId))
      .orderBy(asc(channelsTable.createdAt));
    res.json(rows.map(serialize));
  },
);

router.post(
  "/channels",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const [created] = await db
      .insert(channelsTable)
      .values({
        userId,
        name: name.slice(0, 200),
        type: typeof body.type === "string" ? body.type : "webhook",
        phoneNumber:
          typeof body.phoneNumber === "string"
            ? normalizeE164(body.phoneNumber) ?? body.phoneNumber
            : null,
        defaultRoute:
          typeof body.defaultRoute === "string" ? body.defaultRoute : null,
        isActive: body.isActive === false ? false : true,
        isDefault: false,
        greetingText:
          typeof body.greetingText === "string" ? body.greetingText : null,
        recordCalls:
          typeof body.recordCalls === "boolean" ? body.recordCalls : true,
        allowVoicemail:
          typeof body.allowVoicemail === "boolean" ? body.allowVoicemail : true,
        businessHours:
          body.businessHours && typeof body.businessHours === "object"
            ? (body.businessHours as Record<string, unknown>)
            : null,
        afterHoursBehavior:
          typeof body.afterHoursBehavior === "string" &&
          ["voicemail", "forward", "ai_intake_placeholder", "hangup"].includes(
            body.afterHoursBehavior,
          )
            ? (body.afterHoursBehavior as
                | "voicemail"
                | "forward"
                | "ai_intake_placeholder"
                | "hangup")
            : "voicemail",
        forwardNumber:
          typeof body.forwardNumber === "string"
            ? normalizeE164(body.forwardNumber) ?? body.forwardNumber
            : null,
        maxCallDurationSeconds:
          typeof body.maxCallDurationSeconds === "number"
            ? body.maxCallDurationSeconds
            : null,
        recordingConsentText:
          typeof body.recordingConsentText === "string"
            ? body.recordingConsentText
            : null,
        assignedFlowId:
          typeof body.assignedFlowId === "string" ? body.assignedFlowId : null,
        productMode:
          typeof body.productMode === "string" ? body.productMode : null,
      })
      .returning();
    res.status(201).json(serialize(created!));
  },
);

router.patch(
  "/channels/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<Channel> = {};
    if (typeof body.name === "string") patch.name = body.name.slice(0, 200);
    if (typeof body.type === "string") patch.type = body.type;
    if ("phoneNumber" in body) {
      patch.phoneNumber =
        typeof body.phoneNumber === "string"
          ? normalizeE164(body.phoneNumber) ?? body.phoneNumber
          : null;
    }
    if ("defaultRoute" in body)
      patch.defaultRoute =
        typeof body.defaultRoute === "string" ? body.defaultRoute : null;
    if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
    if ("greetingText" in body)
      patch.greetingText =
        typeof body.greetingText === "string" ? body.greetingText : null;
    if (typeof body.recordCalls === "boolean")
      patch.recordCalls = body.recordCalls;
    if (typeof body.allowVoicemail === "boolean")
      patch.allowVoicemail = body.allowVoicemail;
    if ("businessHours" in body) {
      patch.businessHours =
        body.businessHours && typeof body.businessHours === "object"
          ? (body.businessHours as Channel["businessHours"])
          : null;
    }
    if (
      typeof body.afterHoursBehavior === "string" &&
      ["voicemail", "forward", "ai_intake_placeholder", "hangup"].includes(
        body.afterHoursBehavior,
      )
    ) {
      patch.afterHoursBehavior = body.afterHoursBehavior as
        | "voicemail"
        | "forward"
        | "ai_intake_placeholder"
        | "hangup";
    }
    if ("forwardNumber" in body)
      patch.forwardNumber =
        typeof body.forwardNumber === "string"
          ? normalizeE164(body.forwardNumber) ?? body.forwardNumber
          : null;
    if ("maxCallDurationSeconds" in body)
      patch.maxCallDurationSeconds =
        typeof body.maxCallDurationSeconds === "number"
          ? body.maxCallDurationSeconds
          : null;
    if ("recordingConsentText" in body)
      patch.recordingConsentText =
        typeof body.recordingConsentText === "string"
          ? body.recordingConsentText
          : null;
    if ("assignedFlowId" in body)
      patch.assignedFlowId =
        typeof body.assignedFlowId === "string" ? body.assignedFlowId : null;
    if ("productMode" in body)
      patch.productMode =
        typeof body.productMode === "string" ? body.productMode : null;

    const [updated] = await db
      .update(channelsTable)
      .set(patch)
      .where(and(eq(channelsTable.id, id), eq(channelsTable.userId, userId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    res.json(serialize(updated));
  },
);

router.delete(
  "/channels/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    // Refuse to delete the seeded default channel — users would lose their
    // ingestion landing-pad.
    const [target] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.id, id), eq(channelsTable.userId, userId)))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    if (target.isDefault) {
      res.status(409).json({ error: "Cannot delete the default channel" });
      return;
    }
    await db
      .delete(channelsTable)
      .where(
        and(eq(channelsTable.id, id), eq(channelsTable.userId, userId)),
      );
    res.status(204).send();
  },
);

export default router;
