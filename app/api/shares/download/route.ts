import "server-only";
import { limited, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveDelivery } from "@/lib/services/delivery";
import { mustDownload } from "@/lib/services/mime";

export const dynamic = "force-dynamic";

/**
 * Bytes for someone holding a share link.
 *
 * The share page had a Download button with no onClick. A recipient could see that
 * a file existed, its size and its type, and had no way to get it — the whole point
 * of sending someone a link.
 *
 * Separate from /api/files/download rather than a flag on it. That route starts from
 * "who is signed in, and do they own this"; this one starts from "is this token
 * still good, and what does it permit". Folding them together would mean one handler
 * with two authorisation models, which is how the wrong branch eventually runs.
 *
 * Authority is the token and nothing else. No account, no ownership, no id from the
 * caller — a token names exactly one file, so there is nothing here to point
 * somewhere else.
 */
export const GET = limited(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) throw new ApiError("INVALID_INPUT", 400, "token is required.");

  const admin = createAdminClient();
  const { data: share } = await admin.from("share_links").select("*").eq("token", token).maybeSingle();

  // The same three refusals the resolve route makes, in the same words. A link that
  // renders a page must not then fail differently at the download.
  if (!share) throw new ApiError("SHARE_NOT_FOUND", 404, "This link is no longer available.");
  if (share.is_revoked) throw new ApiError("SHARE_REVOKED", 410, "This link is no longer available.");
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
    throw new ApiError("SHARE_EXPIRED", 410, "This link has expired.");
  }

  if (!share.file_id) {
    // Folder shares would need an archive built somewhere other than a request.
    throw new ApiError("NOT_SUPPORTED", 400, "This link points at a folder. Downloading folders is not available yet.");
  }

  const { data: file } = await admin
    .from("files")
    .select("object_key, original_filename, mime_type, status, trashed_at")
    .eq("id", share.file_id)
    .maybeSingle();

  // Trashed by the owner, or quarantined by an admin. Both stop the link working,
  // and neither says which.
  if (!file || file.trashed_at || file.status !== "ready") {
    throw new ApiError("SHARE_NOT_FOUND", 404, "This link is no longer available.");
  }

  /**
   * "view" gets an inline URL, "download" gets an attachment.
   *
   * The distinction is honest rather than enforced: anything a browser can display
   * it can also save. What it does buy is that a view-only link does not hand over a
   * URL that saves the file under its own name by default, which is the difference
   * the owner was actually expressing.
   */
  // Forced for anything a browser would execute. A share link is the most exposed
  // path in the product — whoever opens it was sent it by a stranger as far as the
  // browser is concerned.
  const forced = mustDownload(String(file.original_filename), file.mime_type ? String(file.mime_type) : null);
  const attachment = forced || share.permission === "download";

  // Class "s": served through Cloudflare, and edge-cacheable — a link posted somewhere
  // busy is the one case where the same bytes really are fetched by many people. The
  // cache key is the object key, so nothing is shared between two different files, and
  // the five-minute lifetime keeps revocation as prompt as it was before.
  const { url: deliveryUrl, expiresIn } = await resolveDelivery({
    objectKey: String(file.object_key),
    deliveryClass: "s",
    disposition: attachment ? "attachment" : "inline",
    filename: String(file.original_filename),
    ...(file.mime_type ? { contentType: String(file.mime_type) } : {}),
    fallbackTtlSeconds: 300,
  });

  await admin
    .from("share_links")
    .update({ access_count: Number(share.access_count ?? 0) + 1 })
    .eq("id", share.id);

  return {
    url: deliveryUrl,
    expiresIn,
    filename: String(file.original_filename),
    disposition: attachment ? ("attachment" as const) : ("inline" as const),
  };
}, DEFAULT_LIMITS.downloadUrl);
