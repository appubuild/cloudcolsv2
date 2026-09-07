import "server-only";
import { limited, requireUser, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  presignUploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
  MULTIPART_MAX_PARTS,
} from "@/lib/services/b2";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** The file, if it belongs to the caller and is still waiting for its bytes. */
async function pendingFile(req: Request, id: string) {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data: file } = await admin
    .from("files")
    .select("id, object_key, status, size_bytes")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!file) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");
  if (file.status !== "pending") throw new ApiError("NOT_PENDING", 409, "That upload is already finished.");
  return { user, admin, file };
}

interface PostBody {
  uploadId?: string;
  /** Which parts to sign for. 1-based. */
  partNumbers?: number[];
}

/**
 * Presigned PUT URLs for a batch of parts.
 *
 * Issued in batches rather than all at once: a 3 GB file is around 190 parts, and
 * signing every one up front wastes work on parts an interrupted upload never
 * reaches. They expire in an hour, so a long upload asks again as it goes.
 *
 * The object key comes from the file's own row, never from the request. That is what
 * makes the upload id safe to keep on the client — a part URL can only ever point at
 * an object the caller owns.
 */
export const POST = limited(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const { id } = (await ctx?.params) ?? { id: "" };
  const { file } = await pendingFile(req, id);
  const body = (await req.json()) as PostBody;

  const uploadId = String(body.uploadId ?? "").trim();
  if (!uploadId) throw new ApiError("INVALID_INPUT", 400, "uploadId is required.");

  const numbers = (body.partNumbers ?? []).map(Number);
  if (numbers.length === 0) throw new ApiError("INVALID_INPUT", 400, "partNumbers is required.");
  if (numbers.length > 100) throw new ApiError("INVALID_INPUT", 400, "Ask for at most 100 parts at a time.");
  for (const n of numbers) {
    if (!Number.isInteger(n) || n < 1 || n > MULTIPART_MAX_PARTS) {
      throw new ApiError("INVALID_INPUT", 400, `Part number ${n} is out of range.`);
    }
  }

  const urls = await Promise.all(
    numbers.map(async (partNumber) => ({
      partNumber,
      url: await presignUploadPart(String(file.object_key), uploadId, partNumber),
    })),
  );

  return { parts: urls, expiresIn: 3600 };
}, DEFAULT_LIMITS.uploadTicket);

interface PutBody {
  uploadId?: string;
  parts?: { partNumber: number; etag: string }[];
}

/**
 * Assemble the uploaded parts into the finished object.
 *
 * Only assembles. The file's row stays `pending` until /api/files/confirm runs, which
 * is where storage is asked what actually landed and the declared size is checked
 * against it. Two steps rather than one because that check is the thing standing
 * between "the client said 3 GB" and "3 GB was billed" — it should not be skippable
 * by taking a different route to the same place.
 */
export const PUT = limited(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const { id } = (await ctx?.params) ?? { id: "" };
  const { file } = await pendingFile(req, id);
  const body = (await req.json()) as PutBody;

  const uploadId = String(body.uploadId ?? "").trim();
  if (!uploadId) throw new ApiError("INVALID_INPUT", 400, "uploadId is required.");

  const parts = body.parts ?? [];
  if (parts.length === 0) throw new ApiError("INVALID_INPUT", 400, "No parts were listed.");
  for (const p of parts) {
    if (!Number.isInteger(p?.partNumber) || !p?.etag) {
      throw new ApiError("INVALID_INPUT", 400, "Each part needs a partNumber and an etag.");
    }
  }

  await completeMultipartUpload(String(file.object_key), uploadId, parts);
  return { assembled: true, parts: parts.length };
}, DEFAULT_LIMITS.uploadTicket);

/**
 * Give up on an upload.
 *
 * Storage holds the parts of an abandoned multipart upload and bills for them, so a
 * cancelled upload says so rather than leaving them to a lifecycle rule. The pending
 * row goes too — it counts against nothing, but a file list full of uploads that
 * never happened is its own problem.
 */
export const DELETE = limited(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const { id } = (await ctx?.params) ?? { id: "" };
  const { admin, file, user } = await pendingFile(req, id);

  const uploadId = new URL(req.url).searchParams.get("uploadId");
  if (uploadId) await abortMultipartUpload(String(file.object_key), uploadId);

  await admin.from("files").delete().eq("id", id).eq("owner_id", user.id);
  return { cancelled: true };
}, DEFAULT_LIMITS.uploadTicket);
