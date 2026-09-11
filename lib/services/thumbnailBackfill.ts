"use client";

// Giving an older file the thumbnail it never got.
//
// Thumbnails are generated at upload, in the browser, because a Worker cannot resize
// anything. Every file uploaded before that existed has none — and the grid was
// fetching the full original to draw each of those tiles, which is the cost the whole
// feature exists to remove.
//
// So when the grid does read an original, it makes the derivative from bytes it
// already has and stores it. The file pays that download once more, and never again.
//
// Entirely best-effort. A failure here leaves the file exactly as it was, and says
// nothing: this is housekeeping the person looking at the grid did not ask for.

import { apiClient } from "@/lib/api/client";
import { THUMBNAIL_MAX_EDGE, THUMBNAIL_QUALITY } from "@/lib/storage/derivatives";
import { pdfFirstPageThumbnail } from "./pdfThumbnail";
import { deliveryCredentials, deliveryCrossOrigin } from "./deliveryFetch";
import { videoThumbnailFromUrl, type MediaThumbnail } from "./thumbnailer";

/** Files this tab has already tried, so a re-render does not try again. */
const attempted = new Set<string>();

/**
 * How many may run at once.
 *
 * Images are cheap. Video is not — decoding one holds a decoder and a socket open —
 * so videos get a queue of one, and a folder full of them backfills steadily instead
 * of all at once.
 */
const MAX_CONCURRENT_IMAGE = 2;
const MAX_CONCURRENT_HEAVY = 1;
let imagesInFlight = 0;
let heavyInFlight = 0;

/** How long to give a remote video to produce a frame before abandoning it. */
const VIDEO_TIMEOUT_MS = 12_000;

function fit(width: number, height: number, max: number): { w: number; h: number } {
  if (width <= 0 || height <= 0) return { w: 0, h: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

/** Draws a decoded frame down to thumbnail size and encodes it. */
async function encode(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  const { w, h } = fit(width, height, THUMBNAIL_MAX_EDGE);
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);

  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/webp", THUMBNAIL_QUALITY);
    } catch {
      // A canvas tainted by a cross-origin draw throws here rather than returning
      // null. It means the delivery URL did not allow this origin to read the pixels.
      resolve(null);
    }
  });
}

/**
 * Shrinks an image, reading through the signed URL rather than the rendered <img>.
 *
 * A canvas drawn from a cross-origin image without CORS is tainted, and toBlob on a
 * tainted canvas throws. Fetching the bytes and decoding them keeps the canvas clean.
 */
async function shrinkImage(url: string): Promise<MediaThumbnail | null> {
  try {
    const res = await fetch(url, { credentials: deliveryCredentials(url) });
    if (!res.ok) return null;
    const blob = await res.blob();

    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      return null;
    }
    try {
      const blob = await encode(bitmap, bitmap.width, bitmap.height);
      return blob
        ? { blob, width: bitmap.width, height: bitmap.height, durationSeconds: null }
        : null;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/**
 * Grabs a frame from a video that is still in storage.
 *
 * The same capture the upload path uses — early candidate timestamps, a check that the
 * frame is not simply blank, and the shape and length read off the decoder — differing
 * only in how the bytes arrive. `preload="metadata"` because they come over the wire:
 * the element fetches the header, seeks, and pulls only what the frame needs, so a
 * 900 MB film costs a few megabytes to take a picture of rather than all of it.
 *
 * That ranging is only possible because the delivery worker honours Range, and the
 * canvas is only readable because the URL allows this origin with credentials.
 */
async function frameFromVideo(url: string): Promise<MediaThumbnail | null> {
  return videoThumbnailFromUrl(url, {
    crossOrigin: deliveryCrossOrigin(url),
    preload: "metadata",
  });
}

/** Reads whatever kind of source this is and returns a thumbnail plus what it learnt. */
async function capture(kind: "image" | "video" | "pdf", url: string): Promise<MediaThumbnail | null> {
  if (kind === "video") return frameFromVideo(url);
  if (kind === "image") return shrinkImage(url);
  // The URL rather than the bytes: pdf.js ranges into it and reads only what the first
  // page needs, so a large document is not downloaded to draw a tile. A page has no
  // duration, and its pixel size is the rendering's rather than the document's, so
  // nothing is recorded about it.
  const blob = await pdfFirstPageThumbnail({ url });
  return blob ? { blob, width: null, height: null, durationSeconds: null } : null;
}

/** Uploads a generated derivative to the key the server chooses for this file. */
async function store(fileId: string, shot: MediaThumbnail): Promise<void> {
  const blob = shot.blob;
  // The server computes the destination from the file's own object key; nothing about
  // where this lands comes from here.
  const ticket = await apiClient.post<{ presignedUrl: string; maxBytes: number }>(
    `/api/files/${fileId}/thumbnail`,
    {},
  );
  if (blob.size > ticket.maxBytes) return;

  const put = await fetch(ticket.presignedUrl, { method: "PUT", body: blob });
  if (!put.ok) return;

  // Confirmed separately, so a thumbnail_url is only recorded for an object that is
  // really there. The shape and length go with it — the decoder had to read them to
  // draw the frame, and recording them saves every later reader a trip to storage.
  await apiClient.put(`/api/files/${fileId}/thumbnail`, {
    width: shot.width,
    height: shot.height,
    durationSeconds: shot.durationSeconds,
  });
}

/**
 * Generates and stores a thumbnail for a file that has none.
 *
 * `kind` says how to read the source, not what the file is: an image is fetched and
 * decoded whole, a video is seeked into. Anything else has no browser-side decoder
 * worth using and is not attempted.
 */
export async function backfillThumbnail(
  fileId: string,
  url: string,
  kind: "image" | "video" | "pdf" = "image",
): Promise<void> {
  if (attempted.has(fileId)) return;

  // Video and PDF both hold a decoder or a worker open for as long as they run, so
  // they share one slot between them. Images are cheap enough to overlap.
  const heavy = kind !== "image";
  if (heavy ? heavyInFlight >= MAX_CONCURRENT_HEAVY : imagesInFlight >= MAX_CONCURRENT_IMAGE) {
    // Not marked attempted: this one was turned away for being busy, not for failing,
    // and it should get another go when the grid next asks.
    return;
  }

  attempted.add(fileId);
  if (heavy) heavyInFlight += 1;
  else imagesInFlight += 1;

  try {
    const shot = await capture(kind, url);
    if (!shot) return;
    await store(fileId, shot);
  } catch {
    // Leave the file as it was.
  } finally {
    if (heavy) heavyInFlight -= 1;
    else imagesInFlight -= 1;
  }
}
