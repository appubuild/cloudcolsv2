import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl } from "@/lib/services/b2";
import { recordActivity } from "@/lib/api/activity";
import { mustDownload } from "@/lib/services/mime";

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
  // "thumb" asks for the stored small version instead of the file itself. It is the
  // difference between a grid costing a few kilobytes per tile and costing the whole
  // original — which is what it cost before thumbnails existed.
  const wantsThumb = url.searchParams.get("variant") === "thumb";

  const admin = createAdminClient();
  const { data: file } = await admin
    .from("files")
    .select("object_key, status, owner_id, original_filename, mime_type, thumbnail_url")
    .eq("id", fileId)
    .eq("owner_id", user.id) // ownership enforced server-side
    .maybeSingle();
  if (!file) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");
  if (file.status !== "ready") throw new ApiError("FILE_NOT_READY", 409, "File is not available.");

  // Drawing a tile in a grid is not something the user did. Recording it would put
  // every file they scrolled past into Recent and drown what they actually opened.
  if (!wantsThumb) {
    // What was done, not only that something was: an attachment is a download, an
    // inline URL is a preview, and Recent should be able to say which.
    await recordActivity(user.id, { fileId }, disposition === "attachment" ? "downloaded" : "previewed");

    // Record access so the file shows in Recent Access (fire-and-forget).
    await admin.from("files").update({ last_accessed_at: new Date().toISOString() }).eq("id", fileId).eq("owner_id", user.id);
  }

  if (wantsThumb) {
    const key = file.thumbnail_url ? String(file.thumbnail_url) : "";
    if (!key) throw new ApiError("NO_THUMBNAIL", 404, "This file has no thumbnail.");
    const thumb = await getPresignedDownloadUrl(key, 900, { contentType: "image/webp" });
    return { presignedUrl: thumb.presignedUrl, expiresIn: thumb.expiresIn, filename: String(file.original_filename) };
  }

  /**
   * A file a browser would execute is never served inline, whatever was asked for.
   *
   * .html and .svg can run script, and a convincing login form hosted on storage the
   * visitor half-recognises is a good phishing page. Storing them is fine — this is
   * about what happens when someone clicks the link.
   */
  const forced = mustDownload(String(file.original_filename), file.mime_type ? String(file.mime_type) : null);
  const effective = forced ? "attachment" : disposition;

  const { presignedUrl, expiresIn } = await getPresignedDownloadUrl(String(file.object_key), 600, {
    // Without the filename the browser saves the storage key — a UUID with no
    // recognisable name — which is what made downloads look like they had failed.
    ...(effective === "attachment" ? { downloadFilename: String(file.original_filename) } : {}),
    ...(file.mime_type ? { contentType: String(file.mime_type) } : {}),
  });
  return { presignedUrl, expiresIn, filename: String(file.original_filename) };
});
