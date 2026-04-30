import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { db, usersTable, callRecordsTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { CreateCheckoutSessionBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { PLANS, getPlanInfo } from "../lib/plans";

const router: IRouter = Router();

const HAS_STRIPE = Boolean(process.env["STRIPE_SECRET_KEY"]);

router.get(
  "/billing/plan",
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
    const plan = getPlanInfo(user.plan);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(callRecordsTable)
      .where(
        and(
          eq(callRecordsTable.userId, userId),
          gte(callRecordsTable.createdAt, monthStart),
        ),
      );
    res.json({
      plan: plan.id,
      callsThisMonth: Number(count) || 0,
      monthlyLimit: plan.monthlyLimit,
      stripeConfigured: HAS_STRIPE,
    });
  },
);

router.post(
  "/billing/checkout",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateCheckoutSessionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const planId = parsed.data.plan;
    if (!(planId in PLANS)) {
      res.status(400).json({ error: "Unknown plan" });
      return;
    }
    if (!HAS_STRIPE) {
      res.json({
        url: null,
        configured: false,
        message:
          "Stripe is not configured yet. Connect Stripe in your environment to enable plan upgrades.",
      });
      return;
    }
    res.json({
      url: null,
      configured: true,
      message: "Stripe checkout flow is not yet wired up in this build.",
    });
  },
);

export default router;
