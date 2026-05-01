import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  channelsTable,
  automationRulesTable,
  receptionistProfilesTable,
  transferTargetsTable,
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  getProductMode,
  listProductModes,
  type ChannelSeed,
  type ProductMode,
  type ReceptionistProfileSeed,
  type RuleSeed,
  type TransferTargetSeed,
} from "../lib/productModes";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get(
  "/setup/product-modes",
  requireAuth,
  async (_req: Request, res: Response): Promise<void> => {
    res.json(
      listProductModes().map((m) => ({
        id: m.id,
        label: m.label,
        description: m.description,
        channelCount: m.channels.length,
        ruleCount: m.rules.length,
        receptionistProfileCount: m.receptionistProfiles.length,
        transferTargetCount: m.transferTargets.length,
        dashboardLabels: m.dashboardLabels,
      })),
    );
  },
);

router.get(
  "/setup/state",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const [user] = await db
      .select({ productMode: usersTable.productMode })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const channels = await db
      .select()
      .from(channelsTable)
      .where(eq(channelsTable.userId, userId));
    const rules = await db
      .select()
      .from(automationRulesTable)
      .where(eq(automationRulesTable.userId, userId));
    const profiles = await db
      .select()
      .from(receptionistProfilesTable)
      .where(eq(receptionistProfilesTable.userId, userId));
    const targets = await db
      .select()
      .from(transferTargetsTable)
      .where(eq(transferTargetsTable.userId, userId));
    res.json({
      productMode: user?.productMode ?? null,
      channelCount: channels.length,
      ruleCount: rules.length,
      receptionistProfileCount: profiles.length,
      transferTargetCount: targets.length,
    });
  },
);

router.post(
  "/setup/apply-mode",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = typeof body.modeId === "string" ? body.modeId : "";
    const mode = getProductMode(id);
    if (!mode) {
      res.status(400).json({ error: `Unknown product mode: ${id}` });
      return;
    }
    const created = {
      channels: 0,
      rules: 0,
      receptionistProfiles: 0,
      transferTargets: 0,
    };

    // Receptionist profiles first so channels can bind to them. Idempotent
    // by name (per workspace).
    const existingProfiles = await db
      .select({
        id: receptionistProfilesTable.id,
        name: receptionistProfilesTable.name,
      })
      .from(receptionistProfilesTable)
      .where(eq(receptionistProfilesTable.userId, userId));
    const profileIdByName = new Map<string, string>(
      existingProfiles.map((p) => [p.name, p.id]),
    );
    for (const seed of mode.receptionistProfiles) {
      if (profileIdByName.has(seed.name)) continue;
      try {
        const id = await insertReceptionistProfile(userId, seed, mode);
        profileIdByName.set(seed.name, id);
        created.receptionistProfiles += 1;
      } catch (err) {
        logger.warn({ err, seed: seed.name }, "Failed to seed receptionist profile");
      }
    }

    // Transfer targets — idempotent by name.
    const existingTargets = await db
      .select({ name: transferTargetsTable.name })
      .from(transferTargetsTable)
      .where(eq(transferTargetsTable.userId, userId));
    const existingTargetNames = new Set(existingTargets.map((t) => t.name));
    for (const seed of mode.transferTargets) {
      if (existingTargetNames.has(seed.name)) continue;
      try {
        await insertTransferTarget(userId, seed, mode.id);
        created.transferTargets += 1;
      } catch (err) {
        logger.warn({ err, seed: seed.name }, "Failed to seed transfer target");
      }
    }

    // Channels — idempotent by name. Bind receptionistProfileId from the
    // map populated above.
    const existingChannels = await db
      .select({ name: channelsTable.name })
      .from(channelsTable)
      .where(eq(channelsTable.userId, userId));
    const existingChannelNames = new Set(existingChannels.map((c) => c.name));
    for (const seed of mode.channels) {
      if (existingChannelNames.has(seed.name)) continue;
      try {
        const profileId = seed.receptionistProfileName
          ? profileIdByName.get(seed.receptionistProfileName) ?? null
          : null;
        await insertChannel(userId, seed, mode.id, profileId);
        created.channels += 1;
      } catch (err) {
        logger.warn({ err, seed: seed.name }, "Failed to seed channel");
      }
    }

    // Rules — idempotent by name.
    const existingRules = await db
      .select({ name: automationRulesTable.name })
      .from(automationRulesTable)
      .where(eq(automationRulesTable.userId, userId));
    const existingRuleNames = new Set(existingRules.map((r) => r.name));
    for (const seed of mode.rules) {
      if (existingRuleNames.has(seed.name)) continue;
      try {
        await insertRule(userId, seed);
        created.rules += 1;
      } catch (err) {
        logger.warn({ err, seed: seed.name }, "Failed to seed rule");
      }
    }

    await db
      .update(usersTable)
      .set({ productMode: mode.id })
      .where(eq(usersTable.id, userId));

    res.json({
      modeId: mode.id,
      created,
      message: `Applied "${mode.label}" — created ${created.channels} channels, ${created.rules} rules, ${created.receptionistProfiles} receptionist profiles, ${created.transferTargets} transfer targets. Existing items were left untouched.`,
    });
  },
);

async function insertChannel(
  userId: string,
  seed: ChannelSeed,
  modeId: string,
  profileId: string | null,
): Promise<void> {
  const existingDefault = seed.isDefault
    ? (
        await db
          .select({ id: channelsTable.id })
          .from(channelsTable)
          .where(
            and(
              eq(channelsTable.userId, userId),
              eq(channelsTable.isDefault, true),
            ),
          )
          .limit(1)
      ).length > 0
    : false;
  await db.insert(channelsTable).values({
    userId,
    name: seed.name,
    type: "twilio",
    isActive: true,
    isDefault: seed.isDefault && !existingDefault ? true : false,
    greetingText: seed.greetingText,
    recordingConsentText: seed.recordingConsentText,
    recordCalls: seed.recordCalls,
    allowVoicemail: seed.allowVoicemail,
    afterHoursBehavior: seed.afterHoursBehavior,
    productMode: modeId,
    liveBehavior: seed.liveBehavior ?? "record_only",
    receptionistProfileId: profileId,
    requireRecordingConsent: seed.requireRecordingConsent ?? false,
    consentScript: seed.consentScript ?? null,
    consentRequiredBeforeRecording:
      seed.consentRequiredBeforeRecording ?? false,
  });
}

async function insertRule(userId: string, seed: RuleSeed): Promise<void> {
  await db.insert(automationRulesTable).values({
    userId,
    name: seed.name,
    triggerType: "call_analyzed",
    conditions: seed.conditions as never,
    actions: seed.actions as never,
    enabled: true,
  });
}

async function insertReceptionistProfile(
  userId: string,
  seed: ReceptionistProfileSeed,
  mode: ProductMode,
): Promise<string> {
  const [created] = await db
    .insert(receptionistProfilesTable)
    .values({
      userId,
      name: seed.name,
      greetingScript: seed.greetingScript,
      fallbackScript: seed.fallbackScript ?? null,
      escalationScript: seed.escalationScript ?? null,
      voicemailScript: seed.voicemailScript ?? null,
      tone: seed.tone,
      intakeSchema: seed.intakeSchema,
      escalationRules: seed.escalationRules,
      enabled: true,
      isDefault: seed.isDefault === true,
      productMode: mode.id,
    })
    .returning({ id: receptionistProfilesTable.id });
  return created!.id;
}

async function insertTransferTarget(
  userId: string,
  seed: TransferTargetSeed,
  modeId: string,
): Promise<void> {
  await db.insert(transferTargetsTable).values({
    userId,
    name: seed.name,
    type: seed.type,
    phoneNumber: seed.phoneNumber ?? null,
    queueName: seed.queueName ?? null,
    priority: seed.priority ?? 100,
    enabled: true,
    productMode: modeId,
  });
}

export default router;
