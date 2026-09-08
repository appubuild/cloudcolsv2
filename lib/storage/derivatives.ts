// Derived objects: small versions of a stored file, kept beside it.
//
// Deterministic, and computed from the original's key rather than stored, so the
// derivative for a file can always be found without a second lookup — and two
// uploads can never collide on one, because the original key already contains a
// uuid.

/** Where the thumbnail for an object lives. */
export function thumbnailKey(objectKey: string): string {
  // {userId}/user-files/{category}/{yyyy}/{mm}/CC-xxx.ext
  //   → {userId}/derivatives/thumbs/CC-xxx.webp
  const parts = objectKey.split("/");
  const userId = parts[0] ?? "unknown";
  const file = parts[parts.length - 1] ?? "file";
  const stem = file.replace(/\.[^.]+$/, "");
  return `${userId}/derivatives/thumbs/${stem}.webp`;
}

/**
 * The longest edge of a generated thumbnail, in pixels.
 *
 * Large enough for the biggest tile the grid draws on a high-density screen, small
 * enough that the whole point holds: the grid was fetching 877 KB originals to fill
 * a 200 px card, and a thumbnail at this size lands in the low tens of kilobytes.
 */
export const THUMBNAIL_MAX_EDGE = 512;

/** WebP quality for generated thumbnails. */
export const THUMBNAIL_QUALITY = 0.72;

/**
 * The most a thumbnail may weigh.
 *
 * A ceiling rather than a target. It is the server's protection against a client
 * uploading something large to a key that is served as a thumbnail — the browser is
 * what generates these, and the browser is not trusted.
 */
export const THUMBNAIL_MAX_BYTES = 512 * 1024;

/**
 * Categories a thumbnail is worth generating for. Everything else has an icon.
 *
 * PDFs are here because a folder of them was otherwise a wall of identical red
 * glyphs. They are the only entry that needs a library to rasterise — see
 * lib/services/pdfThumbnail.ts, which is loaded on demand for exactly that reason.
 */
export function canHaveThumbnail(category: string): boolean {
  return category === "image" || category === "video" || category === "pdf";
}
