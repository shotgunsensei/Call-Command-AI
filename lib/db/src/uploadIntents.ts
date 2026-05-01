import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "./index";
import { uploadIntentsTable } from "./schema";

export type ClaimResult =
  | { ok: true; intentId: string }
  | { ok: false; reason: "missing_or_wrong_owner" | "expired" | "already_attached" };

/**
 * A drizzle "executor" — either the top-level `db` or a transaction handle
 * obtained from `db.transaction(async (tx) => ...)`. Both expose the same
 * query-builder surface, so callers can inject a `tx` to make the claim and
 * any follow-up writes atomic.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/**
 * Atomically claim an upload intent for the given user + objectPath. The
 * UPDATE only succeeds when the intent (a) belongs to the caller, (b) is in
 * `pending` or `uploaded`, and (c) is not yet past its `expires_at`. This
 * eliminates the check-then-update race where two concurrent attach requests
 * could both pass a non-atomic guard.
 *
 * Pass `executor` (a transaction handle) to make the claim atomic with the
 * caller's follow-up writes — if the transaction rolls back, the claim is
 * undone and the intent stays attachable.
 */
export async function claimUploadIntent(opts: {
  userId: string;
  objectPath: string;
  now?: Date;
  executor?: Executor;
}): Promise<ClaimResult> {
  const now = opts.now ?? new Date();
  const exec: Executor = opts.executor ?? db;

  const claimed = await exec
    .update(uploadIntentsTable)
    .set({ status: "attached" })
    .where(
      and(
        eq(uploadIntentsTable.objectPath, opts.objectPath),
        eq(uploadIntentsTable.userId, opts.userId),
        inArray(uploadIntentsTable.status, ["pending", "uploaded"]),
        gt(uploadIntentsTable.expiresAt, now),
      ),
    )
    .returning({ id: uploadIntentsTable.id });

  if (claimed[0]) {
    return { ok: true, intentId: claimed[0].id };
  }

  const [existing] = await exec
    .select({
      userId: uploadIntentsTable.userId,
      status: uploadIntentsTable.status,
      expiresAt: uploadIntentsTable.expiresAt,
    })
    .from(uploadIntentsTable)
    .where(eq(uploadIntentsTable.objectPath, opts.objectPath))
    .limit(1);

  if (!existing || existing.userId !== opts.userId) {
    return { ok: false, reason: "missing_or_wrong_owner" };
  }
  if (existing.status === "attached") {
    return { ok: false, reason: "already_attached" };
  }
  return { ok: false, reason: "expired" };
}

/**
 * Best-effort revert of a claim. Used when the row insert that follows a
 * successful claim fails OUTSIDE a transaction — without this, a transient
 * DB error would leave the intent stuck in `attached` with no call record
 * pointing at it. Safe to call more than once.
 *
 * Note: when claim and insert run inside the same `db.transaction`, a thrown
 * error rolls back the claim automatically and this helper is unnecessary.
 */
export async function unclaimUploadIntent(intentId: string): Promise<void> {
  await db
    .update(uploadIntentsTable)
    .set({ status: "uploaded" })
    .where(
      and(
        eq(uploadIntentsTable.id, intentId),
        eq(uploadIntentsTable.status, "attached"),
      ),
    );
}
