import { getAuth } from "@clerk/express";
import { createClerkClient } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const clerk = createClerkClient({
  secretKey: process.env["CLERK_SECRET_KEY"] || "",
});

const upsertCache = new Map<string, number>();
const UPSERT_TTL_MS = 60_000;

/**
 * Read ADMIN_EMAILS from env. Comma-separated, case-insensitive,
 * whitespace-trimmed. Empty/unset → no admins.
 */
function adminEmailSet(): Set<string> {
  const raw = process.env["ADMIN_EMAILS"];
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function resolveRole(email: string | null | undefined): "admin" | "user" {
  if (!email) return "user";
  return adminEmailSet().has(email.toLowerCase()) ? "admin" : "user";
}

async function ensureUserRow(userId: string): Promise<void> {
  const lastSeen = upsertCache.get(userId);
  if (lastSeen && Date.now() - lastSeen < UPSERT_TTL_MS) return;

  try {
    const existing = await db
      .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (existing.length === 0) {
      const u = await clerk.users.getUser(userId);
      const email =
        u.primaryEmailAddress?.emailAddress ??
        u.emailAddresses[0]?.emailAddress ??
        `${userId}@unknown.local`;
      await db
        .insert(usersTable)
        .values({
          id: userId,
          email,
          name:
            [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null,
          avatarUrl: u.imageUrl || null,
          plan: "free",
          role: resolveRole(email),
        })
        .onConflictDoNothing();
    } else {
      // Reconcile role from ADMIN_EMAILS for existing users so promoting
      // (or demoting) someone is just an env-var change + auth ping.
      const desired = resolveRole(existing[0]!.email);
      if (existing[0]!.role !== desired) {
        await db
          .update(usersTable)
          .set({ role: desired })
          .where(eq(usersTable.id, userId));
      }
    }
    upsertCache.set(userId, Date.now());
  } catch {
    // best-effort; downstream routes will fail safely if needed
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  await ensureUserRow(userId);
  next();
}
