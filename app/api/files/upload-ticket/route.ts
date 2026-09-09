import "server-only";
import { limited, requireUser, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getQuota, assertCanUpload } from "@/lib/api/quota";
import { buildObjectKey, deriveCategory } from "@/lib/storage/categories";
import {
  getPresignedUploadUrl,
  createMultipartUpload,
  MULTIPART_PART_SIZE,
  MULTIPART_THRESHOLD,
  partSizeFor,
} from "@/lib/services/b2";

export const dynamic = "force-dynamic";

interface Body {
  filename: string;
  sizeBytes: number;
  mimeType?: string;
  folderId?: string | null;
}

export const POST = limited(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  if (!body.filename?.trim()) throw new ApiError("INVALID_INPUT", 400, "Filename is required.");
  if (!Number.isFinite(body.sizeBytes)) throw new ApiError("INVALID_INPUT", 400, "sizeBytes must be a number.");

  const quota = await getQuota(user.id);
  assertCanUpload(quota, body.sizeBytes);

  // The destination folder must belong to the caller. Checked here rather than
  // trusted, and answered as NOT_FOUND rather than FORBIDDEN: confirming that an id
  // exists would let someone probe for other people's folders.
  let folderId: string | null = null;
  if (body.folderId) {
    const admin = createAdminClient();
    const { data: folder } = await admin
      .from("folders")
      .select("id")
      .eq("id", body.folderId)
      .eq("owner_id", user.id)
      .is("trashed_at", null)
      .maybeSingle();
    if (!folder) throw new ApiError("FOLDER_NOT_FOUND", 404, "That folder does not exist.");
    folderId = String(folder.id);
  }

  const category = deriveCategory(body.mimeType ?? "", body.filename);
  const objectKey = buildObjectKey(user.id, category, body.filename);
  const contentType = body.mimeType ?? "application/octet-stream";

  /**
   * Small files get one presigned PUT. Large ones get a multipart upload.
   *
   * The threshold exists because multipart costs a create, a complete, and a presign
   * per part — worth it for a file big enough that losing the connection matters, and
   * pure overhead for one that finishes in a single round trip.
   *
   * Above the part limit the parts are made bigger rather than refusing: S3 allows
   * 10,000 parts, and a fixed part size would cap the object at 160 GB.
   */
  const multipart = body.sizeBytes > MULTIPART_THRESHOLD;
  let presignedUrl = "";
  let multipartUploadId: string | null = null;
  let partSize = MULTIPART_PART_SIZE;

  if (multipart) {
    partSize = partSizeFor(body.sizeBytes);
    const created = await createMultipartUpload(objectKey, contentType);
    multipartUploadId = created.uploadId;
  } else {
    const presign = await getPresignedUploadUrl({ objectKey, contentType });
    presignedUrl = presign.presignedUrl;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("files")
    .insert({
      owner_id: user.id,
      folder_id: folderId,
      object_key: objectKey,
      original_filename: body.filename.trim(),
      mime_type: contentType,
      category,
      size_bytes: body.sizeBytes,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) throw new ApiError("UPLOAD_FAILED", 500, error.message);

  return {
    uploadId: String(data.id),
    objectKey,
    presignedUrl,
    partSizeBytes: partSize,
    expiresIn: 3600,
    fileId: String(data.id),
    // What the client should do with what it was given.
    multipart,
    partCount: multipart ? Math.ceil(body.sizeBytes / partSize) : 1,
    /**
     * The storage upload id, held by the client and passed back when asking for part
     * URLs and when completing.
     *
     * Not persisted: it is not a capability on its own. A part URL can only be
     * obtained for a file the caller owns, and the object key those URLs point at is
     * derived server-side from the file's own row — so the worst a wrong id can do is
     * break the sender's own upload.
     */
    multipartUploadId,
  };
}, DEFAULT_LIMITS.uploadTicket);
