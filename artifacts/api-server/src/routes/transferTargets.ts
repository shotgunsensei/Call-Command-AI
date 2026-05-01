import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  transferTargetsTable,
  type TransferTarget,
  type TransferTargetType,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { normalizeE164 } from "../lib/phoneNumbers";

const router: IRouter = Router();

const ALLOWED_TYPES: TransferTargetType[] = [
  "user",
  "queue",
  "external_number",
  "voicemail",
];

function serialize(t: TransferTarget) {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

router.get(
  "/transfer-targets",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(transferTargetsTable)
      .where(eq(transferTargetsTable.userId, userId))
      .orderBy(asc(transferTargetsTable.priority), asc(transferTargetsTable.createdAt));
    res.json(rows.map(serialize));
  },
);

router.post(
  "/transfer-targets",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body["name"] === "string" ? body["name"].trim() : "";
    const type =
      typeof body["type"] === "string" &&
      ALLOWED_TYPES.includes(body["type"] as TransferTargetType)
        ? (body["type"] as TransferTargetType)
        : null;
    if (!name || !type) {
      res.status(400).json({ error: "name and valid type are required" });
      return;
    }
    if (
      type === "external_number" &&
      typeof body["phoneNumber"] !== "string"
    ) {
      res.status(400).json({ error: "external_number requires phoneNumber" });
      return;
    }
    const [created] = await db
      .insert(transferTargetsTable)
      .values({
        userId,
        name: name.slice(0, 200),
        type,
        phoneNumber:
          typeof body["phoneNumber"] === "string"
            ? normalizeE164(body["phoneNumber"]) ?? body["phoneNumber"]
            : null,
        targetUserId:
          typeof body["targetUserId"] === "string" ? body["targetUserId"] : null,
        queueName:
          typeof body["queueName"] === "string" ? body["queueName"] : null,
        businessHours:
          body["businessHours"] && typeof body["businessHours"] === "object"
            ? (body["businessHours"] as TransferTarget["businessHours"])
            : null,
        priority:
          typeof body["priority"] === "number" ? body["priority"] : 100,
        enabled: body["enabled"] === false ? false : true,
        productMode:
          typeof body["productMode"] === "string" ? body["productMode"] : null,
      })
      .returning();
    res.status(201).json(serialize(created!));
  },
);

router.patch(
  "/transfer-targets/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<TransferTarget> = {};
    if (typeof body["name"] === "string") patch.name = body["name"].slice(0, 200);
    if (
      typeof body["type"] === "string" &&
      ALLOWED_TYPES.includes(body["type"] as TransferTargetType)
    ) {
      patch.type = body["type"] as TransferTargetType;
    }
    if ("phoneNumber" in body)
      patch.phoneNumber =
        typeof body["phoneNumber"] === "string"
          ? normalizeE164(body["phoneNumber"]) ?? body["phoneNumber"]
          : null;
    if ("targetUserId" in body)
      patch.targetUserId =
        typeof body["targetUserId"] === "string" ? body["targetUserId"] : null;
    if ("queueName" in body)
      patch.queueName =
        typeof body["queueName"] === "string" ? body["queueName"] : null;
    if ("businessHours" in body)
      patch.businessHours =
        body["businessHours"] && typeof body["businessHours"] === "object"
          ? (body["businessHours"] as TransferTarget["businessHours"])
          : null;
    if (typeof body["priority"] === "number") patch.priority = body["priority"];
    if (typeof body["enabled"] === "boolean") patch.enabled = body["enabled"];
    const [updated] = await db
      .update(transferTargetsTable)
      .set(patch)
      .where(
        and(
          eq(transferTargetsTable.id, id),
          eq(transferTargetsTable.userId, userId),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Transfer target not found" });
      return;
    }
    res.json(serialize(updated));
  },
);

router.delete(
  "/transfer-targets/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const [deleted] = await db
      .delete(transferTargetsTable)
      .where(
        and(
          eq(transferTargetsTable.id, id),
          eq(transferTargetsTable.userId, userId),
        ),
      )
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Transfer target not found" });
      return;
    }
    res.status(204).send();
  },
);

export default router;
