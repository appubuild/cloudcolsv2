import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveDelivery } from "@/lib/services/delivery";
import { recordActivity } from "@/lib/api/activity";
import { defer } from "@/lib/api/defer";
import { establishDeliverySession } from "@/lib/api/deliverySession";
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
  const variant = url.searchParams.get("variant");
  const wantsThumb = variant === "thumb";
  /**
   * "source" is the original, read by the app rather than by the person.
   *
   * The grid asks for it to generate a thumbnail for a file that has none. Without
   * this distinction every tile that did so was recorded as a preview — so scrolling
   * past a folder of un-thumbnailed photos filled Recent Access with files nobody had
   * opened, and stamped last_accessed_at on all of them.
   */
  const isMachineRead = variant === "source";

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
  if (!wantsThumb && !isMachineRead) {
    // Deferred, not awaited. These are two database round trips that the person
    // opening a video gains nothing from waiting on — and they were sitting directly
    // in front of the URL, so every preview paid for them before playback could start.
    // `defer` keeps them running after the response goes out.
    defer(async () => {
      // What was done, not only that something was: an attachment is a download, an
      // inline URL is a preview, and Recent should be able to say which.
      await recordActivity(user.id, { fileId }, disposition === "attachment" ? "downloaded" : "previewed");
      // Record access so the file shows in Recent Access.
      await admin
        .from("files")
        .update({ last_accessed_at: new Date().toISOString() })
        .eq("id", fileId)
        .eq("owner_id", user.id);
    });
  }

  /**
   * Bind every link this route issues to the account that asked for it.
   *
   * These are the person's own files. Without this the URL is a bearer token: pasted
   * into a message it plays for whoever receives it, for as long as it lasts. The
   * cookie set here is what the CDN checks it against.
   */
  const boundTo = await establishDeliverySession(req, user.id);

  if (wantsThumb) {
    const key = file.thumbnail_url ? String(file.thumbnail_url) : "";
    if (!key) throw new ApiError("NO_THUMBNAIL", 404, "This file has no thumbnail.");
    // Class "t": a derivative small enough and impersonal enough to live in the edge
    // cache, keyed by an object key that already begins with this user's id. This is
    // the one delivery path where the second viewer costs storage nothing.
    const thumb = await resolveDelivery({
      objectKey: key,
      deliveryClass: "t",
      disposition: "inline",
      contentType: "image/webp",
      userId: boundTo,
      fallbackTtlSeconds: 3600,
    });
    return {
      presignedUrl: thumb.url,
      expiresIn: thumb.expiresIn,
      via: thumb.via,
      filename: String(file.original_filename),
    };
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

  // Class "p": the user's own file. It travels through Cloudflare — which is what
  // makes the B2 egress free and gives the player a range-capable origin close to the
  // reader — but is never held in the shared edge cache.
  const delivery = await resolveDelivery({
    objectKey: String(file.object_key),
    deliveryClass: "p",
    disposition: effective,
    // Without the filename the browser saves the storage key — a UUID with no
    // recognisable name — which is what made downloads look like they had failed.
    filename: String(file.original_filename),
    ...(file.mime_type ? { contentType: String(file.mime_type) } : {}),
    userId: boundTo,
    fallbackTtlSeconds: 3600,
  });
  return {
    presignedUrl: delivery.url,
    expiresIn: delivery.expiresIn,
    via: delivery.via,
    filename: String(file.original_filename),
  };
});
