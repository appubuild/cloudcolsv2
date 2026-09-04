import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl } from "@/lib/services/b2";

export const dynamic = "force-dynamic";

// Ownership-checked presigned download URL.
// GET /api/files/download?fileId=...  →  { presignedUrl }
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const fileId = url.searchParams.get("fileId");
  if (!fileId) throw new ApiError("INVALID_INPUT", 400, "fileId is required.");
  // "attachment" makes the browser save the file under its original name;
  // "inline" lets a preview render it in place. Both are signed into the URL, so
  // whoever holds it cannot change which one they get.
  const disposition = url.searchParams.get("disposition") === "attachment" ? "attachment" : "inline";

  const admin = createAdminClient();
  const { data: file } = await admin
    .from("files")
    .select("object_key, status, owner_id, original_filename, mime_type")
    .eq("id", fileId)
    .eq("owner_id", user.id) // ownership enforced server-side
    .maybeSingle();
  if (!file) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");
  if (file.status !== "ready") throw new ApiError("FILE_NOT_READY", 409, "File is not available.");

  // Record access so the file shows in Recent Access (fire-and-forget).
  await admin.from("files").update({ last_accessed_at: new Date().toISOString() }).eq("id", fileId).eq("owner_id", user.id);

  const { presignedUrl, expiresIn } = await getPresignedDownloadUrl(String(file.object_key), 600, {
    // Without the filename the browser saves the storage key — a UUID with no
    // recognisable name — which is what made downloads look like they had failed.
    ...(disposition === "attachment" ? { downloadFilename: String(file.original_filename) } : {}),
    ...(file.mime_type ? { contentType: String(file.mime_type) } : {}),
  });
  return { presignedUrl, expiresIn, filename: String(file.original_filename) };
});
