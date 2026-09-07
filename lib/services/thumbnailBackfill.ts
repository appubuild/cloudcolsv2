"use client";

// Giving an older file the thumbnail it never got.
//
// Thumbnails are generated at upload, in the browser, because a Worker cannot resize
// anything. Every file uploaded before that existed has none — and the grid was
// fetching the full original to draw each of those tiles, which is the cost the whole
// feature exists to remove.
//
// So when the grid does download an original, it makes the derivative from bytes it
// already has and stores it. The file pays the full download once more, and never
// again.
//
// Entirely best-effort. A failure here leaves the file exactly as it was.

import { apiClient } from "@/lib/api/client";
import { THUMBNAIL_MAX_EDGE, THUMBNAIL_QUALITY } from "@/lib/storage/derivatives";

/** Files this tab has already tried, so a re-render does not try again. */
const attempted = new Set<string>();

/** How many may be in flight at once, so a folder of photos does not saturate the tab. */
const MAX_CONCURRENT = 2;
let inFlight = 0;

function fit(width: number, height: number, max: number): { w: number; h: number } {
  if (width <= 0 || height <= 0) return { w: 0, h: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

/**
 * Draws an already-loaded image down to thumbnail size.
 *
 * Reads through the signed URL rather than the rendered <img>: a canvas drawn from a
 * cross-origin image without CORS is tainted, and toBlob on a tainted canvas throws.
 * Fetching the bytes and decoding them keeps the canvas clean.
 */
async function shrink(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();

    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      return null;
    }

    const { w, h } = fit(bitmap.width, bitmap.height, THUMBNAIL_MAX_EDGE);
    if (!w || !h) {
      bitmap.close();
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/webp", THUMBNAIL_QUALITY);
    });
  } catch {
    return null;
  }
}

/**
 * Generates and stores a thumbnail for a file that has none.
 *
 * Silent throughout. This is housekeeping the person looking at the grid did not ask
 * for, and telling them it failed would be noise about something they were not
 * trying to do.
 */
export async function backfillThumbnail(fileId: string, imageUrl: string): Promise<void> {
  if (attempted.has(fileId)) return;
  attempted.add(fileId);

  if (inFlight >= MAX_CONCURRENT) return;
  inFlight += 1;

  try {
    const blob = await shrink(imageUrl);
    if (!blob) return;

    // The server computes the destination from the file's own object key; nothing
    // about where this lands comes from here.
    const ticket = await apiClient.post<{ presignedUrl: string; maxBytes: number }>(
      `/api/files/${fileId}/thumbnail`,
      {},
    );
    if (blob.size > ticket.maxBytes) return;

    const put = await fetch(ticket.presignedUrl, { method: "PUT", body: blob });
    if (!put.ok) return;

    // Confirmed separately, so a thumbnail_url is only recorded for an object that is
    // really there.
    await apiClient.put(`/api/files/${fileId}/thumbnail`, {});
  } catch {
    // Leave the file as it was.
  } finally {
    inFlight -= 1;
  }
}
