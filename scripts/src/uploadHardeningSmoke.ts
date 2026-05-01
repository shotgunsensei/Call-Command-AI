/**
 * uploadHardeningSmoke
 *
 * Smoke checks for the upload-intent hardening shipped on 2026-05-01.
 * These exercise the SAME `claimUploadIntent` helper that the production
 * `POST /api/calls` route calls — so a regression in the attach-guard logic
 * will fail this script.
 *
 * Coverage:
 *   1. Unauthenticated request to /api/storage/uploads/request-url returns 401
 *      (real HTTP call against the running api-server).
 *   2. An upload_intent row gets persisted as `pending`.
 *   3. A second user cannot attach an object_path that another user uploaded
 *      (claim helper returns reason='missing_or_wrong_owner').
 *   4. An expired upload_intent cannot be attached (claim helper returns
 *      reason='expired').
 *   5. A valid upload_intent can be attached and is then marked `attached`;
 *      a second attach attempt returns reason='already_attached'.
 *   6. Two concurrent attach attempts for the same object_path race on the
 *      atomic UPDATE — exactly one wins, the other gets
 *      reason='already_attached'. (This is the regression test for the race
 *      that the architect flagged.)
 *
 * Usage: pnpm --filter @workspace/scripts run test:upload-hardening
 */
import {
  db,
  uploadIntentsTable,
  callRecordsTable,
  claimUploadIntent,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const API_BASE = process.env["API_BASE"] ?? "http://localhost:80/api";

type Check = { name: string; ok: boolean; detail?: string };

async function check(
  name: string,
  fn: () => Promise<void>,
  results: Check[],
): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.error(`  FAIL  ${name}\n        ${detail}`);
  }
}

async function makeIntent(opts: {
  userId: string;
  objectPath: string;
  status?: "pending" | "uploaded" | "attached" | "expired";
  expiresAt?: Date;
}): Promise<string> {
  const [row] = await db
    .insert(uploadIntentsTable)
    .values({
      userId: opts.userId,
      workspaceId: null,
      objectPath: opts.objectPath,
      originalFilename: "smoke.mp3",
      mimeType: "audio/mpeg",
      maxSizeBytes: 1024,
      status: opts.status ?? "pending",
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 60_000),
    })
    .returning({ id: uploadIntentsTable.id });
  if (!row) throw new Error("Failed to create test upload_intent");
  return row.id;
}

async function cleanup(userIds: string[]): Promise<void> {
  for (const uid of userIds) {
    await db
      .delete(uploadIntentsTable)
      .where(eq(uploadIntentsTable.userId, uid));
    await db
      .delete(callRecordsTable)
      .where(eq(callRecordsTable.userId, uid));
  }
}

async function main(): Promise<void> {
  const results: Check[] = [];
  const runId = randomUUID().slice(0, 8);
  const userA = `smoke-A-${runId}`;
  const userB = `smoke-B-${runId}`;

  try {
    await check(
      "unauthenticated POST /storage/uploads/request-url -> 401",
      async () => {
        let res: Response;
        try {
          res = await fetch(`${API_BASE}/storage/uploads/request-url`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "x.mp3",
              size: 1,
              contentType: "audio/mpeg",
            }),
          });
        } catch (err) {
          throw new Error(
            `API not reachable at ${API_BASE} (${err instanceof Error ? err.message : err})`,
          );
        }
        if (res.status !== 401) {
          throw new Error(`expected 401, got ${res.status}`);
        }
      },
      results,
    );

    await check(
      "creating an upload_intent persists status=pending",
      async () => {
        const objectPath = `/objects/uploads/${randomUUID()}`;
        await makeIntent({ userId: userA, objectPath });
        const [row] = await db
          .select()
          .from(uploadIntentsTable)
          .where(
            and(
              eq(uploadIntentsTable.userId, userA),
              eq(uploadIntentsTable.objectPath, objectPath),
            ),
          )
          .limit(1);
        if (!row) throw new Error("intent row not found");
        if (row.status !== "pending") {
          throw new Error(`expected status=pending, got ${row.status}`);
        }
      },
      results,
    );

    await check(
      "user B cannot claim an intent owned by user A",
      async () => {
        const objectPath = `/objects/uploads/${randomUUID()}`;
        await makeIntent({ userId: userA, objectPath });
        const r = await claimUploadIntent({ userId: userB, objectPath });
        if (r.ok) throw new Error("claim unexpectedly succeeded");
        if (r.reason !== "missing_or_wrong_owner") {
          throw new Error(`expected missing_or_wrong_owner, got ${r.reason}`);
        }
      },
      results,
    );

    await check(
      "expired upload_intent cannot be claimed",
      async () => {
        const objectPath = `/objects/uploads/${randomUUID()}`;
        await makeIntent({
          userId: userA,
          objectPath,
          expiresAt: new Date(Date.now() - 60_000),
        });
        const r = await claimUploadIntent({ userId: userA, objectPath });
        if (r.ok) throw new Error("claim unexpectedly succeeded on expired intent");
        if (r.reason !== "expired") {
          throw new Error(`expected expired, got ${r.reason}`);
        }
      },
      results,
    );

    await check(
      "valid claim flips status to attached; re-claim returns already_attached",
      async () => {
        const objectPath = `/objects/uploads/${randomUUID()}`;
        const intentId = await makeIntent({ userId: userA, objectPath });

        const r = await claimUploadIntent({ userId: userA, objectPath });
        if (!r.ok) throw new Error(`claim failed: ${JSON.stringify(r)}`);

        const [row] = await db
          .select({ status: uploadIntentsTable.status })
          .from(uploadIntentsTable)
          .where(eq(uploadIntentsTable.id, intentId))
          .limit(1);
        if (!row) throw new Error("intent vanished after claim");
        if (row.status !== "attached") {
          throw new Error(`expected attached after claim, got ${row.status}`);
        }

        const dupe = await claimUploadIntent({ userId: userA, objectPath });
        if (dupe.ok) throw new Error("re-claim unexpectedly succeeded");
        if (dupe.reason !== "already_attached") {
          throw new Error(`expected already_attached, got ${dupe.reason}`);
        }
      },
      results,
    );

    await check(
      "concurrent claims for same object_path: exactly one wins",
      async () => {
        const trials = 8;
        let totalWins = 0;
        let totalLosses = 0;
        for (let i = 0; i < trials; i++) {
          const objectPath = `/objects/uploads/${randomUUID()}`;
          await makeIntent({ userId: userA, objectPath });
          const [a, b] = await Promise.all([
            claimUploadIntent({ userId: userA, objectPath }),
            claimUploadIntent({ userId: userA, objectPath }),
          ]);
          const wins = [a, b].filter((r) => r.ok).length;
          const losses = [a, b].filter(
            (r) => !r.ok && r.reason === "already_attached",
          ).length;
          if (wins !== 1 || losses !== 1) {
            throw new Error(
              `trial ${i}: expected 1 win + 1 already_attached, got ${JSON.stringify({ a, b })}`,
            );
          }
          totalWins += wins;
          totalLosses += losses;
        }
        if (totalWins !== trials || totalLosses !== trials) {
          throw new Error(
            `aggregate mismatch: wins=${totalWins} losses=${totalLosses} of ${trials} trials`,
          );
        }
      },
      results,
    );
  } finally {
    await cleanup([userA, userB]);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nSmoke results: ${results.length - failed.length}/${results.length} passed`,
  );
  if (failed.length > 0) {
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("smoke runner crashed", err);
    process.exit(1);
  });
