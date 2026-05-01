import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  channelsTable,
  receptionistProfilesTable,
  type Channel,
  type ChannelLiveBehavior,
} from "@workspace/db";
import { and, asc, eq, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { normalizeE164 } from "../lib/phoneNumbers";

const router: IRouter = Router();

const VALID_LIVE_BEHAVIORS: ReadonlyArray<ChannelLiveBehavior> = [
  "record_only",
  "forward_only",
  "voicemail_only",
  "ai_receptionist",
  "ai_screen_then_transfer",
  "ai_after_hours_intake",
];

const VALID_AFTER_HOURS = [
  "voicemail",
  "forward",
  "ai_intake_placeholder",
  "hangup",
] as const;

function serialize(c: Channel) {
  return {
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/**
 * Confirm `profileId` (if non-null) belongs to `userId`. Used to prevent
 * one workspace from binding a channel to another workspace's profile.
 */
async function profileBelongsToUser(
  userId: string,
  profileId: string | null,
): Promise<boolean> {
  if (!profileId) return true;
  const [r] = await db
    .select({ id: receptionistProfilesTable.id })
    .from(receptionistProfilesTable)
    .where(
      and(
        eq(receptionistProfilesTable.id, profileId),
        eq(receptionistProfilesTable.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(r);
}

/**
 * Global phone-number uniqueness guard. A Twilio number can only route
 * to one workspace at a time, so two channels owning the same E.164 is
 * always a configuration mistake. Enforced at the application layer
 * (rather than as a DB unique constraint) so legacy duplicate rows can
 * still be edited and resolved manually.
 */
async function phoneNumberIsAvailable(args: {
  phoneE164: string | null;
  excludeChannelId?: string | null;
}): Promise<boolean> {
  if (!args.phoneE164) return true;
  const all = await db.select().from(channelsTable);
  return !all.some(
    (c) =>
      (args.excludeChannelId ? c.id !== args.excludeChannelId : true) &&
      normalizeE164(c.phoneNumber) === args.phoneE164,
  );
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

    const phoneE164 =
      typeof body.phoneNumber === "string"
        ? normalizeE164(body.phoneNumber) ?? body.phoneNumber
        : null;
    if (
      phoneE164 &&
      !(await phoneNumberIsAvailable({ phoneE164 }))
    ) {
      res
        .status(409)
        .json({ error: `phoneNumber ${phoneE164} is already used by another channel` });
      return;
    }

    let liveBehavior: ChannelLiveBehavior = "record_only";
    if ("liveBehavior" in body) {
      if (
        typeof body.liveBehavior === "string" &&
        VALID_LIVE_BEHAVIORS.includes(body.liveBehavior as ChannelLiveBehavior)
      ) {
        liveBehavior = body.liveBehavior as ChannelLiveBehavior;
      } else if (body.liveBehavior != null) {
        res.status(400).json({
          error: `liveBehavior must be one of: ${VALID_LIVE_BEHAVIORS.join(", ")}`,
        });
        return;
      }
    }

    let receptionistProfileId: string | null = null;
    if (typeof body.receptionistProfileId === "string" && body.receptionistProfileId) {
      const ok = await profileBelongsToUser(userId, body.receptionistProfileId);
      if (!ok) {
        res.status(400).json({
          error: "receptionistProfileId does not belong to this workspace",
        });
        return;
      }
      receptionistProfileId = body.receptionistProfileId;
    }

    const [created] = await db
      .insert(channelsTable)
      .values({
        userId,
        name: name.slice(0, 200),
        type: typeof body.type === "string" ? body.type : "webhook",
        phoneNumber: phoneE164,
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
            ? (body.businessHours as Channel["businessHours"])
            : null,
        afterHoursBehavior:
          typeof body.afterHoursBehavior === "string" &&
          (VALID_AFTER_HOURS as readonly string[]).includes(body.afterHoursBehavior)
            ? (body.afterHoursBehavior as Channel["afterHoursBehavior"])
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
        liveBehavior,
        receptionistProfileId,
        requireRecordingConsent:
          typeof body.requireRecordingConsent === "boolean"
            ? body.requireRecordingConsent
            : false,
        consentScript:
          typeof body.consentScript === "string" ? body.consentScript : null,
        consentRequiredBeforeRecording:
          typeof body.consentRequiredBeforeRecording === "boolean"
            ? body.consentRequiredBeforeRecording
            : false,
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
      const next =
        typeof body.phoneNumber === "string"
          ? normalizeE164(body.phoneNumber) ?? body.phoneNumber
          : null;
      if (
        next &&
        !(await phoneNumberIsAvailable({
          phoneE164: next,
          excludeChannelId: id,
        }))
      ) {
        res.status(409).json({
          error: `phoneNumber ${next} is already used by another channel`,
        });
        return;
      }
      patch.phoneNumber = next;
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
      (VALID_AFTER_HOURS as readonly string[]).includes(body.afterHoursBehavior)
    ) {
      patch.afterHoursBehavior =
        body.afterHoursBehavior as Channel["afterHoursBehavior"];
    } else if (body.afterHoursBehavior != null && typeof body.afterHoursBehavior === "string") {
      res.status(400).json({
        error: `afterHoursBehavior must be one of: ${VALID_AFTER_HOURS.join(", ")}`,
      });
      return;
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

    // Phase 3 fields — Live AI receptionist + consent.
    if ("liveBehavior" in body) {
      if (body.liveBehavior == null) {
        patch.liveBehavior = "record_only";
      } else if (
        typeof body.liveBehavior === "string" &&
        VALID_LIVE_BEHAVIORS.includes(body.liveBehavior as ChannelLiveBehavior)
      ) {
        patch.liveBehavior = body.liveBehavior as ChannelLiveBehavior;
      } else {
        res.status(400).json({
          error: `liveBehavior must be one of: ${VALID_LIVE_BEHAVIORS.join(", ")}`,
        });
        return;
      }
    }
    if ("receptionistProfileId" in body) {
      if (body.receptionistProfileId == null || body.receptionistProfileId === "") {
        patch.receptionistProfileId = null;
      } else if (typeof body.receptionistProfileId === "string") {
        const ok = await profileBelongsToUser(userId, body.receptionistProfileId);
        if (!ok) {
          res.status(400).json({
            error: "receptionistProfileId does not belong to this workspace",
          });
          return;
        }
        patch.receptionistProfileId = body.receptionistProfileId;
      }
    }
    if (typeof body.requireRecordingConsent === "boolean")
      patch.requireRecordingConsent = body.requireRecordingConsent;
    if ("consentScript" in body)
      patch.consentScript =
        typeof body.consentScript === "string" ? body.consentScript : null;
    if (typeof body.consentRequiredBeforeRecording === "boolean")
      patch.consentRequiredBeforeRecording = body.consentRequiredBeforeRecording;

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
      .where(and(eq(channelsTable.id, id), eq(channelsTable.userId, userId)));
    res.status(204).send();
  },
);

// Suppress unused-import warning — `ne` is kept available for future
// scoped uniqueness checks (e.g. per-user, excluding the row being patched).
void ne;

export default router;
