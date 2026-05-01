import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  automationRulesTable,
  type RuleAction,
  type RuleCondition,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { ensureDefaultRules } from "../services/rulesEngine";

const router: IRouter = Router();

function isValidActionType(t: unknown): boolean {
  return (
    t === "create_ticket" ||
    t === "create_lead" ||
    t === "create_task" ||
    t === "send_webhook"
  );
}

function sanitizeActions(input: unknown): RuleAction[] | null {
  if (!Array.isArray(input)) return null;
  const out: RuleAction[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (!isValidActionType(obj["type"])) return null;
    out.push(obj as unknown as RuleAction);
  }
  return out;
}

function sanitizeConditions(input: unknown): RuleCondition | null {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;
  return input as RuleCondition;
}

router.get(
  "/automation-rules",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    await ensureDefaultRules(userId);
    const rows = await db
      .select()
      .from(automationRulesTable)
      .where(eq(automationRulesTable.userId, userId))
      .orderBy(asc(automationRulesTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    );
  },
);

router.post(
  "/automation-rules",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const body = req.body ?? {};
    const name = typeof body["name"] === "string" ? body["name"].trim() : "";
    if (!name) {
      res.status(400).json({ error: "Name required" });
      return;
    }
    const conditions = sanitizeConditions(body["conditions"]);
    if (conditions === null) {
      res.status(400).json({ error: "Invalid conditions" });
      return;
    }
    const actions = sanitizeActions(body["actions"]);
    if (actions === null) {
      res.status(400).json({ error: "Invalid actions" });
      return;
    }
    const [row] = await db
      .insert(automationRulesTable)
      .values({
        userId,
        name,
        triggerType:
          typeof body["triggerType"] === "string"
            ? body["triggerType"]
            : "call_analyzed",
        conditions,
        actions,
        enabled: body["enabled"] !== false,
        isDefault: false,
      })
      .returning();
    res.status(201).json({
      ...row!,
      createdAt: row!.createdAt.toISOString(),
      updatedAt: row!.updatedAt.toISOString(),
    });
  },
);

router.patch(
  "/automation-rules/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (typeof body["name"] === "string") updates["name"] = body["name"];
    if (body["conditions"] !== undefined) {
      const c = sanitizeConditions(body["conditions"]);
      if (c === null) {
        res.status(400).json({ error: "Invalid conditions" });
        return;
      }
      updates["conditions"] = c;
    }
    if (body["actions"] !== undefined) {
      const a = sanitizeActions(body["actions"]);
      if (a === null) {
        res.status(400).json({ error: "Invalid actions" });
        return;
      }
      updates["actions"] = a;
    }
    if (typeof body["enabled"] === "boolean")
      updates["enabled"] = body["enabled"];
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No updates" });
      return;
    }
    const [row] = await db
      .update(automationRulesTable)
      .set(updates)
      .where(
        and(
          eq(automationRulesTable.id, id),
          eq(automationRulesTable.userId, userId),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  },
);

router.delete(
  "/automation-rules/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const result = await db
      .delete(automationRulesTable)
      .where(
        and(
          eq(automationRulesTable.id, id),
          eq(automationRulesTable.userId, userId),
        ),
      )
      .returning({ id: automationRulesTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
