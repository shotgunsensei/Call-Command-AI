import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { db, callRecordsTable, flowLogsTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get(
  "/calls/:id/flow-logs",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const id = String(req.params.id);
    const [call] = await db
      .select()
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.id, id),
          eq(callRecordsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!call) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    // Defense-in-depth: even though the call ownership check above already
    // gates access, re-filter by userId on flow_logs so an attacker who
    // guessed a call id cannot read another tenant's logs if the call
    // ownership check ever regresses.
    const rows = await db
      .select()
      .from(flowLogsTable)
      .where(
        and(
          eq(flowLogsTable.callRecordId, id),
          eq(flowLogsTable.userId, userId),
        ),
      )
      .orderBy(asc(flowLogsTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  },
);

export default router;
