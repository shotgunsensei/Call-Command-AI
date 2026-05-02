import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, callRecordsTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { getPlanInfo } from "../lib/plans";

const router: IRouter = Router();

const HAS_OPENAI =
  Boolean(process.env["AI_INTEGRATIONS_OPENAI_API_KEY"]) &&
  Boolean(process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]);

function startOfMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

router.get(
  "/me",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.userId, userId),
          gte(callRecordsTable.createdAt, startOfMonth()),
        ),
      );

    const plan = getPlanInfo(user.plan);
    const role = user.role === "admin" ? "admin" : "user";
    // Admins have no monthly cap. We surface a sentinel large number so
    // the UI's progress bars don't divide by anything tiny.
    const effectiveLimit =
      role === "admin" ? Number.MAX_SAFE_INTEGER : plan.monthlyLimit;

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      plan: plan.id,
      role,
      callsThisMonth: Number(count) || 0,
      monthlyLimit: effectiveLimit,
      demoMode: !HAS_OPENAI,
    });
  },
);

export default router;
