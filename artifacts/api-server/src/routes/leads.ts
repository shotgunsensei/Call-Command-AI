import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { db, leadsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

function serialize(row: typeof leadsTable.$inferSelect): Record<string, unknown> {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get(
  "/leads",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.userId, userId))
      .orderBy(desc(leadsTable.createdAt))
      .limit(500);
    res.json(rows.map(serialize));
  },
);

router.patch(
  "/leads/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    for (const k of ["name", "phone", "company", "intent", "status"] as const) {
      if (body[k] !== undefined) updates[k] = body[k];
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No updates" });
      return;
    }
    const [row] = await db
      .update(leadsTable)
      .set(updates)
      .where(and(eq(leadsTable.id, id), eq(leadsTable.userId, userId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serialize(row));
  },
);

router.delete(
  "/leads/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const result = await db
      .delete(leadsTable)
      .where(and(eq(leadsTable.id, id), eq(leadsTable.userId, userId)))
      .returning({ id: leadsTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
