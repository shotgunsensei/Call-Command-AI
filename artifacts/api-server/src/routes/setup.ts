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
  usersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  getProductMode,
  listProductModes,
  type ChannelSeed,
  type RuleSeed,
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
    res.json({
      productMode: user?.productMode ?? null,
      channelCount: channels.length,
      ruleCount: rules.length,
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
    const created = { channels: 0, rules: 0 };

    // Channels — only seed names that don't already exist for this user.
    const existingChannels = await db
      .select({ name: channelsTable.name })
      .from(channelsTable)
      .where(eq(channelsTable.userId, userId));
    const existingChannelNames = new Set(existingChannels.map((c) => c.name));
    for (const seed of mode.channels) {
      if (existingChannelNames.has(seed.name)) continue;
      try {
        await insertChannel(userId, seed, mode.id);
        created.channels += 1;
      } catch (err) {
        logger.warn({ err, seed: seed.name }, "Failed to seed channel");
      }
    }

    // Rules — only seed names that don't already exist.
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
      message: `Applied "${mode.label}" — created ${created.channels} channels and ${created.rules} rules. Existing items were left untouched.`,
    });
  },
);

async function insertChannel(
  userId: string,
  seed: ChannelSeed,
  modeId: string,
): Promise<void> {
  // Only allow one default per user — don't promote a new one if one
  // already exists.
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
  });
}

async function insertRule(userId: string, seed: RuleSeed): Promise<void> {
  await db.insert(automationRulesTable).values({
    userId,
    name: seed.name,
    triggerType: "call_analyzed",
    // Cast through unknown — the productModes seed shape is intentionally
    // loose so seeds can declare any combination of supported condition
    // keys without re-importing the typed RuleCondition.
    conditions: seed.conditions as never,
    actions: seed.actions as never,
    enabled: true,
  });
}

export default router;
