import "server-only";
import { limited, requireUser, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getQuota, assertCanUpload } from "@/lib/api/quota";
import { buildObjectKey, deriveCategory } from "@/lib/storage/categories";
import { getPresignedUploadUrl } from "@/lib/services/b2";

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

  const presign = await getPresignedUploadUrl({ objectKey, contentType });

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
    presignedUrl: presign.presignedUrl,
    partSizeBytes: 10 * 1024 * 1024,
    expiresIn: presign.expiresIn,
    fileId: String(data.id),
  };
}, DEFAULT_LIMITS.uploadTicket);
