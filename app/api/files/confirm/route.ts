import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { headObject } from "@/lib/services/b2";
import { mapFile } from "@/lib/api/mappers";
import { deriveCategory } from "@/lib/storage/categories";
import { validateMime } from "@/lib/services/mime";
import { deliver } from "@/lib/jobs/webhookDelivery";

export const dynamic = "force-dynamic";

interface Body {
  uploadId: string;
  fileId: string;
}

export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;

  const admin = createAdminClient();
  const { data: file } = await admin
    .from("files")
    .select("*")
    .eq("id", body.fileId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!file) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");

  // Verify the object actually exists in B2 and reconcile size.
  const head = await headObject(file.object_key);
  if (!head) throw new ApiError("UPLOAD_FAILED", 500, "Uploaded object was not found in storage.");

  const { data: updated, error } = await admin
    .from("files")
    .update({ status: "ready", size_bytes: head.sizeBytes || file.size_bytes })
    .eq("id", body.fileId)
    .eq("owner_id", user.id)
    .select("*")
    .single();
  if (error) throw new ApiError("UPLOAD_FAILED", 500, error.message);

  // Security: validate the file against the MIME/extension allow-list using the
  // server-recorded values (never trusting the client). Blocks executables and
  // disguised/unsupported types.
  const v = validateMime(String(updated.original_filename), updated.mime_type ? String(updated.mime_type) : null);
  if (!v.allowed) {
    await admin.from("files").delete().eq("id", body.fileId).eq("owner_id", user.id);
    throw new ApiError("UNSUPPORTED_MEDIA", 415, v.reason ?? "Unsupported file type.");
  }

  // Recompute category from authoritative metadata + canonical MIME.
  const category = deriveCategory(v.effectiveMime, updated.original_filename);
  const { data: final } = await admin
    .from("files")
    .update({ category })
    .eq("id", body.fileId)
    .select("*")
    .single();

  // Note: the files_quota_trigger in Postgres re-syncs storage_used_bytes.
  const mapped = mapFile(final ?? updated);

  // Dispatch async webhook + thumbnail generation (never blocks the response).
  deliver({ id: String((final ?? updated).id), type: "file.created", fileId: String((final ?? updated).id), objectKey: String((final ?? updated).object_key), ownerId: user.id, timestamp: new Date().toISOString() }, user.id).catch(() => {});
  return mapped;
});
