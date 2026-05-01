import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { db, ticketsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

function serialize(row: typeof ticketsTable.$inferSelect): Record<string, unknown> {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get(
  "/tickets",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.userId, userId))
      .orderBy(desc(ticketsTable.createdAt))
      .limit(500);
    res.json(rows.map(serialize));
  },
);

router.patch(
  "/tickets/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    for (const k of ["title", "description", "priority", "status"] as const) {
      if (body[k] !== undefined) updates[k] = body[k];
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No updates" });
      return;
    }
    const [row] = await db
      .update(ticketsTable)
      .set(updates)
      .where(and(eq(ticketsTable.id, id), eq(ticketsTable.userId, userId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serialize(row));
  },
);

router.delete(
  "/tickets/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const result = await db
      .delete(ticketsTable)
      .where(and(eq(ticketsTable.id, id), eq(ticketsTable.userId, userId)))
      .returning({ id: ticketsTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
