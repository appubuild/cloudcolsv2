// Handing a listing its pictures, rather than making the browser ask for each one.
//
// A file row carries the storage key of its thumbnail, which a browser cannot use.
// So every tile in the grid used to call /api/files/download for its own signed URL:
// a folder of forty files was forty round trips, each one an authentication, a
// database read and a signature, before a single picture appeared. The list had
// already done the authentication and the database read; only the signature was
// missing, and that is local arithmetic.
//
// Minting them here costs one HMAC per file — microseconds — and removes the round
// trips entirely. The URLs are stable within their window, so a browser that has seen
// a tile before does not even fetch the image again.

import "server-only";
import type { File } from "@/lib/types";
import { cdnUrl } from "@/lib/services/cdn";
import { establishDeliverySession } from "@/lib/api/deliverySession";

/**
 * Returns the files with a ready-to-use `thumbnailSrc` wherever one exists.
 *
 * Best-effort: a file whose URL cannot be minted simply comes back without one, and
 * the tile falls back to asking for it as it did before. A listing must not fail
 * because a picture could not be signed.
 */
export async function withThumbnailUrls(
  req: Request,
  userId: string,
  files: File[],
): Promise<File[]> {
  const withThumbs = files.filter((f) => f.thumbnailUrl);
  if (withThumbs.length === 0) return files;

  // One cookie for the whole listing, not one per file. It is what the CDN checks a
  // bound link against, so it has to be set on the response that carries the links.
  const boundTo = await establishDeliverySession(req, userId);

  const signed = new Map<string, string>();
  await Promise.all(
    withThumbs.map(async (file) => {
      try {
        const url = await cdnUrl(String(file.thumbnailUrl), {
          deliveryClass: "t",
          disposition: "inline",
          contentType: "image/webp",
          userId: boundTo,
        });
        if (url) signed.set(file.id, url);
      } catch {
        // One unsigned thumbnail is a tile that asks for its own URL, not a failure.
      }
    }),
  );

  if (signed.size === 0) return files;
  return files.map((f) => (signed.has(f.id) ? { ...f, thumbnailSrc: signed.get(f.id)! } : f));
}
