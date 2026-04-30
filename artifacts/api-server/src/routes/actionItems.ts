import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  db,
  actionItemsTable,
  callRecordsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { UpdateActionItemBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.patch(
  "/action-items/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const parsed = UpdateActionItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const itemId = String(req.params["id"]);
    const [item] = await db
      .select({
        id: actionItemsTable.id,
        callRecordId: actionItemsTable.callRecordId,
        ownerId: callRecordsTable.userId,
      })
      .from(actionItemsTable)
      .innerJoin(
        callRecordsTable,
        eq(actionItemsTable.callRecordId, callRecordsTable.id),
      )
      .where(eq(actionItemsTable.id, itemId))
      .limit(1);
    if (!item || item.ownerId !== userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const updates: Partial<typeof actionItemsTable.$inferInsert> = {};
    const d = parsed.data;
    if (d.title !== undefined) updates.title = d.title;
    if (d.description !== undefined) updates.description = d.description;
    if (d.status !== undefined) updates.status = d.status;
    if (d.priority !== undefined) updates.priority = d.priority;
    if (d.dueDate !== undefined)
      updates.dueDate = d.dueDate ? new Date(d.dueDate) : null;

    const [updated] = await db
      .update(actionItemsTable)
      .set(updates)
      .where(
        and(
          eq(actionItemsTable.id, item.id),
          eq(actionItemsTable.callRecordId, item.callRecordId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Update failed" });
      return;
    }

    res.json({
      id: updated.id,
      callRecordId: updated.callRecordId,
      title: updated.title,
      description: updated.description,
      dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
      priority: updated.priority,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  },
);

export default router;
