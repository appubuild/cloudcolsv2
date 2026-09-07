import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getPresignedUploadUrl, headObject } from "@/lib/services/b2";
import { thumbnailKey, canHaveThumbnail, THUMBNAIL_MAX_BYTES } from "@/lib/storage/derivatives";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Storing a thumbnail the browser generated.
 *
 * Workers cannot resize an image — no ffmpeg, no native binaries — so the small
 * version is made where the file already is, in the browser, at upload time. The
 * server's job is to say where it goes and to check what arrived.
 *
 * The key is computed here from the file's own object key, never accepted from the
 * client. A client-supplied path is how a "thumbnail" upload becomes a write to
 * somebody else's object.
 *
 * Two steps, like the main upload: POST issues a presigned PUT, PUT confirms the
 * bytes landed. Recording the URL without checking is exactly the bug the old
 * background job had — it wrote a thumbnail_url for an object it never created, and
 * every reader believed it.
 */
async function ownedFile(req: Request, id: string) {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data: file } = await admin
    .from("files")
    .select("id, object_key, category, status, thumbnail_url")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!file) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");
  return { user, admin, file };
}

/** Issue a presigned PUT for this file's thumbnail. */
export const POST = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const { id } = (await ctx?.params) ?? { id: "" };
  const { file } = await ownedFile(req, id);

  if (!canHaveThumbnail(String(file.category))) {
    throw new ApiError("NO_THUMBNAIL", 400, "Files of this type do not get a thumbnail.");
  }

  const key = thumbnailKey(String(file.object_key));
  const { presignedUrl, expiresIn } = await getPresignedUploadUrl({ objectKey: key, contentType: "image/webp" });
  return { objectKey: key, presignedUrl, expiresIn, maxBytes: THUMBNAIL_MAX_BYTES };
});

/** Confirm the thumbnail is really in storage, then record it. */
export const PUT = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const { id } = (await ctx?.params) ?? { id: "" };
  const { admin, file } = await ownedFile(req, id);

  const key = thumbnailKey(String(file.object_key));
  const head = await headObject(key);
  if (!head) throw new ApiError("THUMBNAIL_MISSING", 422, "No thumbnail was found in storage.");

  // The browser made this, so its size is not something to take on trust. Anything
  // over the ceiling is not a thumbnail, whatever it is.
  if (head.sizeBytes > THUMBNAIL_MAX_BYTES) {
    throw new ApiError("THUMBNAIL_TOO_LARGE", 413, "That thumbnail is too large.");
  }

  // The key, not a URL. Where it can be read from depends on whether a CDN is
  // configured, and that is a delivery decision made at read time — a URL baked in
  // here would be wrong the moment the CDN is turned on.
  const { error } = await admin.from("files").update({ thumbnail_url: key }).eq("id", id);
  if (error) throw new ApiError("UPDATE_FAILED", 500, error.message);

  return { objectKey: key, sizeBytes: head.sizeBytes };
});
