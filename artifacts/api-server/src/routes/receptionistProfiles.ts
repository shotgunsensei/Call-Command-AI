import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  receptionistProfilesTable,
  type ReceptionistProfile,
  type IntakeSchema,
  type EscalationRules,
  type ReceptionistTone,
  type ReceptionistVoiceProvider,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const ALLOWED_TONES: ReceptionistTone[] = [
  "professional",
  "friendly",
  "urgent",
  "concise",
  "warm",
];
const ALLOWED_VOICE_PROVIDERS: ReceptionistVoiceProvider[] = [
  "twilio",
  "elevenlabs_placeholder",
  "openai_realtime_placeholder",
];

function serialize(p: ReceptionistProfile) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function pickIntakeSchema(value: unknown): IntakeSchema {
  if (!value || typeof value !== "object") return { fields: [] };
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj["fields"])) return { fields: [] };
  // Light shape sanitation — keep only key/label/required/allowedValues/prompt.
  const fields = obj["fields"]
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
    .map((f) => ({
      key: String(f["key"] ?? "").slice(0, 80),
      label: String(f["label"] ?? "").slice(0, 200),
      required: f["required"] !== false,
      allowedValues: Array.isArray(f["allowedValues"])
        ? (f["allowedValues"] as unknown[])
            .map((v) => String(v).slice(0, 100))
            .filter(Boolean)
        : undefined,
      prompt:
        typeof f["prompt"] === "string" ? String(f["prompt"]).slice(0, 400) : undefined,
    }))
    .filter((f) => f.key);
  return { fields };
}

function pickEscalationRules(value: unknown): EscalationRules {
  if (!value || typeof value !== "object") return {};
  const obj = value as Record<string, unknown>;
  return {
    emergencyKeywords: Array.isArray(obj["emergencyKeywords"])
      ? (obj["emergencyKeywords"] as unknown[]).map((s) => String(s).slice(0, 80)).filter(Boolean)
      : undefined,
    angrySentimentEscalates:
      typeof obj["angrySentimentEscalates"] === "boolean"
        ? obj["angrySentimentEscalates"]
        : undefined,
    vipNumbers: Array.isArray(obj["vipNumbers"])
      ? (obj["vipNumbers"] as unknown[]).map((s) => String(s).slice(0, 30)).filter(Boolean)
      : undefined,
    afterHoursEmergencyTransferTargetId:
      typeof obj["afterHoursEmergencyTransferTargetId"] === "string"
        ? obj["afterHoursEmergencyTransferTargetId"]
        : null,
  };
}

router.get(
  "/receptionist-profiles",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(receptionistProfilesTable)
      .where(eq(receptionistProfilesTable.userId, userId))
      .orderBy(asc(receptionistProfilesTable.createdAt));
    res.json(rows.map(serialize));
  },
);

router.get(
  "/receptionist-profiles/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const [row] = await db
      .select()
      .from(receptionistProfilesTable)
      .where(
        and(
          eq(receptionistProfilesTable.id, id),
          eq(receptionistProfilesTable.userId, userId),
        ),
      )
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(serialize(row));
  },
);

router.post(
  "/receptionist-profiles",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body["name"] === "string" ? body["name"].trim() : "";
    const greetingScript =
      typeof body["greetingScript"] === "string" ? body["greetingScript"].trim() : "";
    if (!name || !greetingScript) {
      res.status(400).json({ error: "name and greetingScript are required" });
      return;
    }
    const tone =
      typeof body["tone"] === "string" && ALLOWED_TONES.includes(body["tone"] as ReceptionistTone)
        ? (body["tone"] as ReceptionistTone)
        : "professional";
    const voiceProvider =
      typeof body["voiceProvider"] === "string" &&
      ALLOWED_VOICE_PROVIDERS.includes(body["voiceProvider"] as ReceptionistVoiceProvider)
        ? (body["voiceProvider"] as ReceptionistVoiceProvider)
        : "twilio";
    // First profile becomes the workspace default automatically.
    const existing = await db
      .select({ id: receptionistProfilesTable.id })
      .from(receptionistProfilesTable)
      .where(eq(receptionistProfilesTable.userId, userId))
      .limit(1);
    const isDefault =
      existing.length === 0 ? true : Boolean(body["isDefault"]);

    if (isDefault && existing.length > 0) {
      // Demote other defaults so there's at most one.
      await db
        .update(receptionistProfilesTable)
        .set({ isDefault: false })
        .where(eq(receptionistProfilesTable.userId, userId));
    }

    const [created] = await db
      .insert(receptionistProfilesTable)
      .values({
        userId,
        channelId:
          typeof body["channelId"] === "string" ? body["channelId"] : null,
        name: name.slice(0, 200),
        voiceProvider,
        greetingScript,
        fallbackScript:
          typeof body["fallbackScript"] === "string" ? body["fallbackScript"] : null,
        escalationScript:
          typeof body["escalationScript"] === "string" ? body["escalationScript"] : null,
        voicemailScript:
          typeof body["voicemailScript"] === "string" ? body["voicemailScript"] : null,
        tone,
        intakeSchema: pickIntakeSchema(body["intakeSchema"]),
        escalationRules: pickEscalationRules(body["escalationRules"]),
        enabled: body["enabled"] === false ? false : true,
        isDefault,
        productMode:
          typeof body["productMode"] === "string" ? body["productMode"] : null,
      })
      .returning();
    res.status(201).json(serialize(created!));
  },
);

router.patch(
  "/receptionist-profiles/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<ReceptionistProfile> = {};
    if (typeof body["name"] === "string") patch.name = body["name"].slice(0, 200);
    if (typeof body["greetingScript"] === "string") patch.greetingScript = body["greetingScript"];
    if ("fallbackScript" in body)
      patch.fallbackScript =
        typeof body["fallbackScript"] === "string" ? body["fallbackScript"] : null;
    if ("escalationScript" in body)
      patch.escalationScript =
        typeof body["escalationScript"] === "string" ? body["escalationScript"] : null;
    if ("voicemailScript" in body)
      patch.voicemailScript =
        typeof body["voicemailScript"] === "string" ? body["voicemailScript"] : null;
    if (
      typeof body["tone"] === "string" &&
      ALLOWED_TONES.includes(body["tone"] as ReceptionistTone)
    ) {
      patch.tone = body["tone"] as ReceptionistTone;
    }
    if (
      typeof body["voiceProvider"] === "string" &&
      ALLOWED_VOICE_PROVIDERS.includes(body["voiceProvider"] as ReceptionistVoiceProvider)
    ) {
      patch.voiceProvider = body["voiceProvider"] as ReceptionistVoiceProvider;
    }
    if ("intakeSchema" in body) patch.intakeSchema = pickIntakeSchema(body["intakeSchema"]);
    if ("escalationRules" in body)
      patch.escalationRules = pickEscalationRules(body["escalationRules"]);
    if (typeof body["enabled"] === "boolean") patch.enabled = body["enabled"];
    if ("channelId" in body)
      patch.channelId = typeof body["channelId"] === "string" ? body["channelId"] : null;
    if (body["isDefault"] === true) {
      await db
        .update(receptionistProfilesTable)
        .set({ isDefault: false })
        .where(eq(receptionistProfilesTable.userId, userId));
      patch.isDefault = true;
    }
    const [updated] = await db
      .update(receptionistProfilesTable)
      .set(patch)
      .where(
        and(
          eq(receptionistProfilesTable.id, id),
          eq(receptionistProfilesTable.userId, userId),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(serialize(updated));
  },
);

router.delete(
  "/receptionist-profiles/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const [deleted] = await db
      .delete(receptionistProfilesTable)
      .where(
        and(
          eq(receptionistProfilesTable.id, id),
          eq(receptionistProfilesTable.userId, userId),
        ),
      )
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.status(204).send();
  },
);

export default router;
