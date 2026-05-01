import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { db, tasksTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

function serialize(row: typeof tasksTable.$inferSelect): Record<string, unknown> {
  return {
    ...row,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get(
  "/tasks",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const rows = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.userId, userId))
      .orderBy(asc(tasksTable.dueDate))
      .limit(500);
    res.json(rows.map(serialize));
  },
);

router.patch(
  "/tasks/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (body["title"] !== undefined) updates["title"] = body["title"];
    if (body["description"] !== undefined)
      updates["description"] = body["description"];
    if (body["status"] !== undefined) updates["status"] = body["status"];
    if (body["dueDate"] !== undefined) {
      updates["dueDate"] = body["dueDate"]
        ? new Date(String(body["dueDate"]))
        : null;
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No updates" });
      return;
    }
    const [row] = await db
      .update(tasksTable)
      .set(updates)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(serialize(row));
  },
);

router.delete(
  "/tasks/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params["id"]);
    const result = await db
      .delete(tasksTable)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
      .returning({ id: tasksTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
