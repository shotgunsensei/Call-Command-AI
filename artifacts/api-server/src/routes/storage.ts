import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";
import {
  db,
  callRecordsTable,
  uploadIntentsTable,
} from "@workspace/db";
import { and, eq, lt, or } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Upload intents expire after 24 hours by default.
const UPLOAD_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload. Before the URL is issued we record
 * an `upload_intents` row that binds the (soon-to-exist) object path to the
 * authenticated user. Subsequent calls must reference an intent that the same
 * user owns and that has not expired.
 */
router.post(
  "/storage/uploads/request-url",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    try {
      const userId = req.userId!;
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      const expiresAt = new Date(Date.now() + UPLOAD_INTENT_TTL_MS);
      await db.insert(uploadIntentsTable).values({
        userId,
        workspaceId: null,
        objectPath,
        originalFilename: parsed.data.name,
        mimeType: parsed.data.contentType,
        maxSizeBytes: parsed.data.size,
        status: "pending",
        expiresAt,
      });

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR. Access is granted when the
 * caller either (a) owns a non-expired upload intent for the object path, or
 * (b) owns a call_record whose fileUrl matches the object path. The intent
 * check covers freshly uploaded files; the call_record check covers files
 * already attached to a call.
 */
router.get(
  "/storage/objects/*path",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.path;
      const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
      const objectPath = `/objects/${wildcardPath}`;
      const userId = req.userId!;

      const [callOwned] = await db
        .select({ id: callRecordsTable.id })
        .from(callRecordsTable)
        .where(
          and(
            eq(callRecordsTable.userId, userId),
            eq(callRecordsTable.fileUrl, objectPath),
          ),
        )
        .limit(1);

      let allowed = Boolean(callOwned);
      if (!allowed) {
        const [intent] = await db
          .select({
            id: uploadIntentsTable.id,
            status: uploadIntentsTable.status,
            expiresAt: uploadIntentsTable.expiresAt,
          })
          .from(uploadIntentsTable)
          .where(
            and(
              eq(uploadIntentsTable.userId, userId),
              eq(uploadIntentsTable.objectPath, objectPath),
            ),
          )
          .limit(1);
        if (
          intent &&
          intent.status !== "expired" &&
          intent.expiresAt.getTime() > Date.now()
        ) {
          allowed = true;
        }
      }

      if (!allowed) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const response = await objectStorageService.downloadObject(objectFile);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        req.log.warn({ err: error }, "Object not found");
        res.status(404).json({ error: "Object not found" });
        return;
      }
      req.log.error({ err: error }, "Error serving object");
      res.status(500).json({ error: "Failed to serve object" });
    }
  },
);

/**
 * Mark intents whose `expires_at` has passed as `expired`. Best-effort
 * housekeeping — safe to call repeatedly. Returns the number of rows touched.
 */
export async function expireStaleUploadIntents(): Promise<number> {
  const now = new Date();
  const updated = await db
    .update(uploadIntentsTable)
    .set({ status: "expired" })
    .where(
      and(
        lt(uploadIntentsTable.expiresAt, now),
        or(
          eq(uploadIntentsTable.status, "pending"),
          eq(uploadIntentsTable.status, "uploaded"),
        )!,
      ),
    )
    .returning({ id: uploadIntentsTable.id });
  return updated.length;
}

export default router;
