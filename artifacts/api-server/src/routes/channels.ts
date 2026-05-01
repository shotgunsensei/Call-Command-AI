import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { db, channelsTable, type Channel } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

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
  if (args.phoneNumber) {
    const [c] = await db
      .select()
      .from(channelsTable)
      .where(
        and(
          eq(channelsTable.userId, args.userId),
          eq(channelsTable.phoneNumber, args.phoneNumber),
        ),
      )
      .limit(1);
    if (c) return c;
  }
  return ensureDefaultChannel(args.userId);
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
          typeof body.phoneNumber === "string" ? body.phoneNumber : null,
        defaultRoute:
          typeof body.defaultRoute === "string" ? body.defaultRoute : null,
        isActive: body.isActive === false ? false : true,
        isDefault: false,
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
    if ("phoneNumber" in body)
      patch.phoneNumber =
        typeof body.phoneNumber === "string" ? body.phoneNumber : null;
    if ("defaultRoute" in body)
      patch.defaultRoute =
        typeof body.defaultRoute === "string" ? body.defaultRoute : null;
    if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
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
