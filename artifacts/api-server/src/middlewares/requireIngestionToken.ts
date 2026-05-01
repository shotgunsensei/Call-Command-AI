import type { NextFunction, Request, Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHash, timingSafeEqual } from "node:crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ingestionUserId?: string;
    }
  }
}

export function hashIngestionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function constantTimeHexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function extractToken(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m && m[1]) return m[1].trim();
  }
  const x = req.headers["x-ingestion-token"];
  if (typeof x === "string" && x.trim()) return x.trim();
  const q = req.query["token"];
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
}

export async function requireIngestionToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractToken(req);
  if (!token || token.length < 16) {
    res.status(401).json({ error: "Missing ingestion token" });
    return;
  }

  // Hash the candidate token in app space (constant-time on input length)
  // and look it up by an indexed unique hash column. The DB never sees the
  // raw token, and a token-bytes timing leak is impossible because the
  // lookup key is a uniformly-distributed 256-bit digest.
  const candidateHash = hashIngestionToken(token);

  const rows = await db
    .select({
      id: usersTable.id,
      ingestionTokenHash: usersTable.ingestionTokenHash,
    })
    .from(usersTable)
    .where(eq(usersTable.ingestionTokenHash, candidateHash))
    .limit(1);

  const match = rows[0];
  if (!match || !match.ingestionTokenHash) {
    res.status(401).json({ error: "Invalid ingestion token" });
    return;
  }
  // Defence in depth: still constant-time compare the stored hash.
  if (!constantTimeHexEquals(match.ingestionTokenHash, candidateHash)) {
    res.status(401).json({ error: "Invalid ingestion token" });
    return;
  }
  req.ingestionUserId = match.id;
  next();
}
