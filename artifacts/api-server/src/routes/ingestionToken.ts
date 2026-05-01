import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { hashIngestionToken } from "../middlewares/requireIngestionToken";

const router: IRouter = Router();

function newToken(): string {
  return "cci_" + randomBytes(24).toString("base64url");
}

function endpointsFor(): {
  twilio: string;
  email: string;
  webhook: string;
} {
  // Returned as relative paths because the public origin depends on which
  // Replit domain the user is hitting. The frontend prefixes with
  // location.origin.
  return {
    twilio: "/api/ingest/twilio",
    email: "/api/ingest/email",
    webhook: "/api/ingest/webhook",
  };
}

router.get(
  "/me/ingestion-token",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const [user] = await db
      .select({ ingestionTokenHash: usersTable.ingestionTokenHash })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    // We do NOT store or return the raw token. The token is shown exactly
    // once at rotation time. Subsequent GETs only reveal whether one exists.
    res.json({
      token: null,
      hasToken: Boolean(user?.ingestionTokenHash),
      endpoints: endpointsFor(),
    });
  },
);

router.post(
  "/me/ingestion-token",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId!;
    const token = newToken();
    const hash = hashIngestionToken(token);
    await db
      .update(usersTable)
      .set({ ingestionTokenHash: hash })
      .where(eq(usersTable.id, userId));
    res.json({ token, hasToken: true, endpoints: endpointsFor() });
  },
);

export default router;
