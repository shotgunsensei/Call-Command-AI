import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { db, integrationsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateIntegrationBody,
  UpdateIntegrationBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { safeFetchWebhook, validateWebhookUrl } from "../lib/safeWebhook";

const router: IRouter = Router();

function serialize(i: typeof integrationsTable.$inferSelect) {
  return {
    id: i.id,
    userId: i.userId,
    type: i.type,
    name: i.name,
    webhookUrl: i.webhookUrl,
    enabled: i.enabled,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

router.get(
  "/integrations",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const list = await db
      .select()
      .from(integrationsTable)
      .where(eq(integrationsTable.userId, userId))
      .orderBy(desc(integrationsTable.createdAt));
    res.json(list.map(serialize));
  },
);

router.post(
  "/integrations",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const parsed = CreateIntegrationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const v = validateWebhookUrl(parsed.data.webhookUrl);
    if (!v.ok) {
      res.status(400).json({ error: v.error });
      return;
    }
    const [created] = await db
      .insert(integrationsTable)
      .values({
        userId,
        type: parsed.data.type,
        name: parsed.data.name,
        webhookUrl: parsed.data.webhookUrl,
        enabled: parsed.data.enabled ?? true,
      })
      .returning();
    if (!created) {
      res.status(500).json({ error: "Insert failed" });
      return;
    }
    res.status(201).json(serialize(created));
  },
);

router.patch(
  "/integrations/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const parsed = UpdateIntegrationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const updates: Partial<typeof integrationsTable.$inferInsert> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.webhookUrl !== undefined) {
      const v = validateWebhookUrl(parsed.data.webhookUrl);
      if (!v.ok) {
        res.status(400).json({ error: v.error });
        return;
      }
      updates.webhookUrl = parsed.data.webhookUrl;
    }
    if (parsed.data.enabled !== undefined)
      updates.enabled = parsed.data.enabled;

    const id = String(req.params["id"]);
    const [updated] = await db
      .update(integrationsTable)
      .set(updates)
      .where(
        and(
          eq(integrationsTable.id, id),
          eq(integrationsTable.userId, userId),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serialize(updated));
  },
);

router.delete(
  "/integrations/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const result = await db
      .delete(integrationsTable)
      .where(
        and(
          eq(integrationsTable.id, id),
          eq(integrationsTable.userId, userId),
        ),
      )
      .returning({ id: integrationsTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).end();
  },
);

router.post(
  "/integrations/:id/test",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const [integration] = await db
      .select()
      .from(integrationsTable)
      .where(
        and(
          eq(integrationsTable.id, id),
          eq(integrationsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!integration) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const response = await safeFetchWebhook(integration.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "callcommand",
          test: true,
          integration: { id: integration.id, type: integration.type },
          message: "This is a test ping from CallCommand AI.",
          sentAt: new Date().toISOString(),
        }),
      });
      res.json({
        ok: response.ok,
        status: response.status,
        message: response.ok
          ? "Test ping delivered"
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

export default router;
