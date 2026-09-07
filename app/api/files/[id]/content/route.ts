import "server-only";
import { limited, requireUser, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getPresignedUploadUrl, headObject } from "@/lib/services/b2";
import { isTextEditable, TEXT_EDIT_MAX_BYTES } from "@/lib/services/mime";
import { getQuota } from "@/lib/api/quota";
import { recordActivity } from "@/lib/api/activity";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Replacing a text file's contents in place.
 *
 * Editing a note, a README or a config and saving it back is the thing people expect
 * from files they can already read. It is deliberately limited to text: opening a
 * .docx in a text editor shows a wall of bytes and offers to save it back corrupted,
 * so `isTextEditable` refuses those rather than pretending.
 *
 * Two steps, like every other upload here. POST issues a presigned PUT for the file's
 * own object key; PUT confirms what actually landed and reconciles the recorded size.
 * The bytes go straight to storage — a save is an upload, and uploads do not travel
 * through our compute.
 *
 * The key is the file's own, so a save overwrites rather than orphaning the old
 * object and leaving it billed forever.
 */
async function editableFile(req: Request, id: string) {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data: file } = await admin
    .from("files")
    .select("id, object_key, original_filename, mime_type, size_bytes, status")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!file) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");
  if (file.status !== "ready") throw new ApiError("FILE_NOT_READY", 409, "That file is not available.");
  if (!isTextEditable(String(file.original_filename), file.mime_type ? String(file.mime_type) : null)) {
    throw new ApiError("NOT_EDITABLE", 400, "That file is not a text file, so it cannot be edited here.");
  }
  return { user, admin, file };
}

interface PostBody {
  /** What the new contents will weigh, so the quota is checked before anything moves. */
  sizeBytes?: number;
}

/** A presigned PUT that overwrites this file. */
export const POST = limited(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const { id } = (await ctx?.params) ?? { id: "" };
  const { user, file } = await editableFile(req, id);
  const body = (await req.json().catch(() => ({}))) as PostBody;

  const nextSize = Number(body.sizeBytes ?? 0);
  if (!Number.isFinite(nextSize) || nextSize < 0) {
    throw new ApiError("INVALID_INPUT", 400, "sizeBytes must be a number.");
  }
  if (nextSize > TEXT_EDIT_MAX_BYTES) {
    throw new ApiError("FILE_TOO_LARGE", 413, "That is too large to edit in the browser.");
  }

  /**
   * Only the growth counts against the quota.
   *
   * An edit replaces the object, so the file's current size is already accounted for.
   * Charging the whole new size would refuse someone editing a file that fits.
   */
  const growth = nextSize - Number(file.size_bytes ?? 0);
  if (growth > 0) {
    const quota = await getQuota(user.id);
    if (quota.used + growth > quota.quota) {
      throw new ApiError("QUOTA_EXCEEDED", 413, "Saving this would put you over your storage limit.");
    }
  }

  const contentType = file.mime_type ? String(file.mime_type) : "text/plain";
  const presign = await getPresignedUploadUrl({ objectKey: String(file.object_key), contentType });

  return { presignedUrl: presign.presignedUrl, expiresIn: presign.expiresIn, maxBytes: TEXT_EDIT_MAX_BYTES };
}, DEFAULT_LIMITS.uploadTicket);

/** Confirm the new contents landed, and reconcile the recorded size. */
export const PUT = limited(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const { id } = (await ctx?.params) ?? { id: "" };
  const { user, admin, file } = await editableFile(req, id);

  // Storage is the authority on what was actually stored. The client's claim about
  // the new size is not recorded — the same rule the upload confirm follows.
  const head = await headObject(String(file.object_key));
  if (!head) throw new ApiError("SAVE_FAILED", 422, "The saved file was not found in storage.");
  if (head.sizeBytes > TEXT_EDIT_MAX_BYTES) {
    throw new ApiError("FILE_TOO_LARGE", 413, "The saved file is larger than the editor allows.");
  }

  const { data: updated, error } = await admin
    .from("files")
    .update({ size_bytes: head.sizeBytes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id, size_bytes, updated_at")
    .maybeSingle();
  if (error) throw new ApiError("SAVE_FAILED", 500, error.message);
  if (!updated) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");

  await recordActivity(user.id, { fileId: id }, "uploaded");

  return {
    id: String(updated.id),
    sizeBytes: Number(updated.size_bytes),
    updatedAt: String(updated.updated_at),
  };
}, DEFAULT_LIMITS.uploadTicket);
