/**
 * normalizeCallFileUrls
 *
 * One-time (idempotent) maintenance script that rewrites legacy
 * `call_records.file_url` values into the canonical `/objects/uploads/<id>`
 * format used by the current storage layer.
 *
 * Behaviour
 * ---------
 * - Already-canonical rows (`/objects/...`) are skipped.
 * - Rows where the URL points at the GCS bucket inside our private object
 *   directory are rewritten to `/objects/<entityId>`.
 * - NULL or empty `file_url` rows are left alone.
 * - Anything that cannot be safely normalized is logged and left untouched.
 *   No row is ever deleted.
 * - Pass `--dry-run` to log proposed changes without writing.
 *
 * Usage
 * -----
 *   pnpm --filter @workspace/scripts run normalize-call-file-urls
 *   pnpm --filter @workspace/scripts run normalize-call-file-urls -- --dry-run
 *
 * Safe to run more than once.
 */
import { db, callRecordsTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";

type Result = {
  scanned: number;
  alreadyCanonical: number;
  normalized: number;
  unrecognized: number;
  dryRun: boolean;
};

function getPrivateObjectDir(): string {
  const dir = process.env["PRIVATE_OBJECT_DIR"];
  if (!dir || !dir.trim()) {
    throw new Error(
      "PRIVATE_OBJECT_DIR is not set. Configure object storage before running this script.",
    );
  }
  return dir.endsWith("/") ? dir : `${dir}/`;
}

function tryNormalize(
  rawPath: string,
  privateDir: string,
): { kind: "canonical" | "normalized" | "unrecognized"; value: string } {
  const trimmed = rawPath.trim();
  if (trimmed.startsWith("/objects/")) {
    return { kind: "canonical", value: trimmed };
  }

  if (trimmed.startsWith("https://storage.googleapis.com/")) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return { kind: "unrecognized", value: trimmed };
    }
    const rawObjectPath = url.pathname;
    if (!rawObjectPath.startsWith(privateDir)) {
      return { kind: "unrecognized", value: trimmed };
    }
    const entityId = rawObjectPath.slice(privateDir.length);
    if (!entityId) return { kind: "unrecognized", value: trimmed };
    return { kind: "normalized", value: `/objects/${entityId}` };
  }

  return { kind: "unrecognized", value: trimmed };
}

export async function normalizeCallFileUrls(
  opts: { dryRun?: boolean } = {},
): Promise<Result> {
  const dryRun = Boolean(opts.dryRun);
  const privateDir = getPrivateObjectDir();

  const rows = await db
    .select({ id: callRecordsTable.id, fileUrl: callRecordsTable.fileUrl })
    .from(callRecordsTable)
    .where(isNotNull(callRecordsTable.fileUrl));

  const result: Result = {
    scanned: rows.length,
    alreadyCanonical: 0,
    normalized: 0,
    unrecognized: 0,
    dryRun,
  };

  for (const row of rows) {
    if (!row.fileUrl) continue;
    const decision = tryNormalize(row.fileUrl, privateDir);
    if (decision.kind === "canonical") {
      result.alreadyCanonical += 1;
      continue;
    }
    if (decision.kind === "unrecognized") {
      result.unrecognized += 1;
      console.warn(
        `[normalize] Skipping call_record ${row.id}: file_url not recognized (${row.fileUrl})`,
      );
      continue;
    }
    result.normalized += 1;
    if (dryRun) {
      console.log(
        `[normalize] (dry-run) ${row.id}: ${row.fileUrl} -> ${decision.value}`,
      );
    } else {
      await db
        .update(callRecordsTable)
        .set({ fileUrl: decision.value })
        .where(eq(callRecordsTable.id, row.id));
      console.log(
        `[normalize] ${row.id}: ${row.fileUrl} -> ${decision.value}`,
      );
    }
  }

  return result;
}

const isDirectRun = (() => {
  if (typeof process === "undefined" || !process.argv[1]) return false;
  try {
    const url = new URL(import.meta.url);
    return url.pathname === process.argv[1] || url.pathname.endsWith("/normalizeCallFileUrls.ts");
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const dryRun = process.argv.includes("--dry-run");
  normalizeCallFileUrls({ dryRun })
    .then((r) => {
      console.log("[normalize] Done", r);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[normalize] Failed", err);
      process.exit(1);
    });
}
