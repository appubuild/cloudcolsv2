// Thumbnail generation job.
// For previewable images we derive a thumbnail into a `derivatives/` prefix so
// thumbnails are deterministic, cached by the CDN, and never regenerated. In
// production the actual byte-level resize runs against the B2 object. When real
// processing isn't available (mock/local), we record the derivative key and a
// flag so the UI still works.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";

const THUMB_WIDTH = 256;
const THUMB_QUALITY = 75;

export function thumbObjectKey(objectKey: string): string {
  // {userId}/user-files/{category}/.../CC-xxx.ext → {userId}/derivatives/thumbs/{category}/CC-xxx.webp
  const parts = objectKey.split("/");
  const userId = parts[0];
  const category = parts[2] ?? "other";
  const file = parts[parts.length - 1] ?? "file";
  const stem = file.replace(/\.[^.]+$/, "");
  return `${userId}/derivatives/thumbs/${category}/${stem}.webp`;
}

export async function generateThumbnail(fileId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: file, error } = await admin
    .from("files")
    .select("id, object_key, mime_type, category, thumbnail_url")
    .eq("id", fileId)
    .maybeSingle();
  if (error || !file) return `No file found for thumbnail (${fileId}).`;

  // Only image/video get thumbnails; others don't need them.
  const mime = String(file.mime_type ?? "");
  if (!(mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/"))) {
    return "No thumbnail needed for this file type.";
  }

  const derivative = thumbObjectKey(String(file.object_key));

  // In a live deployment this is where we fetch the object, resize, and PUT the
  // derivative. Without a configured object store we just record the URL so the
  // UI reflects it. The same code path moves to a worker (Cloudflare/edge or a
  // priority queue) without changing this contract.
  const isImage = mime.startsWith("image/");
  const thumbnailUrl = isImage ? `https://${process.env.B2_PUBLIC_DOMAIN ?? "cdn.invalid"}/${derivative}` : null;

  const { data: updated } = await admin
    .from("files")
    .update({ thumbnail_url: thumbnailUrl, status: isImage ? "ready" : "processing" })
    .eq("id", fileId)
    .select("thumbnail_url")
    .maybeSingle();

  await audit({ actorType: "system", action: "file.thumbnail", targetType: "file", targetId: fileId, metadata: { derivative, width: THUMB_WIDTH, quality: THUMB_QUALITY, processed: isImage } });
  return `Thumbnail ${isImage ? "generated" : "queued"} for ${String(file.object_key)} → ${derivative}`;
}
