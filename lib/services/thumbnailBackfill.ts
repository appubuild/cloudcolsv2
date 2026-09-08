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
async function shrinkImage(url: string): Promise<Blob | null> {
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
    try {
      return await encode(bitmap, bitmap.width, bitmap.height);
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
 * This is the one place the range support added to the CDN pays off directly. The
 * video element is given a URL, not a file: it fetches the header, seeks, and pulls
 * only the bytes around the frame it needs. A 900 MB film costs a few megabytes to
 * take a picture of, which is the difference between this being reasonable and being
 * the exact thing the brief forbids — sending a whole original to draw a 100 px tile.
 *
 * `crossOrigin` is required, not cosmetic: without it the canvas is tainted by the
 * draw and the encode throws. It works because the delivery worker sends CORS headers;
 * against a bare storage URL it may not, and then this quietly gives up.
 */
async function frameFromVideo(url: string): Promise<Blob | null> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";

  try {
    const frame = await new Promise<HTMLVideoElement | null>((resolve) => {
      // A codec the browser cannot decode fires neither event, so everything is on a
      // timer. Without it one unplayable file would hold the queue of one forever.
      const timer = setTimeout(() => resolve(null), VIDEO_TIMEOUT_MS);
      const done = (value: HTMLVideoElement | null) => {
        clearTimeout(timer);
        resolve(value);
      };

      video.onerror = () => done(null);
      video.onloadedmetadata = () => {
        // A second in, or the middle of anything shorter. The first frame of a video
        // is very often black, which makes a thumbnail that looks broken.
        const target =
          Number.isFinite(video.duration) && video.duration > 0 ? Math.min(1, video.duration / 2) : 0;
        video.onseeked = () => done(video);
        try {
          video.currentTime = target;
        } catch {
          done(null);
        }
      };

      video.src = url;
    });

    if (!frame || !frame.videoWidth) return null;
    return await encode(frame, frame.videoWidth, frame.videoHeight);
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      /* releasing the decoder is best-effort too */
    }
  }
}

/** Uploads a generated derivative to the key the server chooses for this file. */
async function store(fileId: string, blob: Blob): Promise<void> {
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
  // really there.
  await apiClient.put(`/api/files/${fileId}/thumbnail`, {});
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
    const blob =
      kind === "video"
        ? await frameFromVideo(url)
        : kind === "pdf"
          // The URL rather than the bytes: pdf.js ranges into it and reads only what
          // the first page needs, so a large document is not downloaded to draw a tile.
          ? await pdfFirstPageThumbnail({ url })
          : await shrinkImage(url);
    if (!blob) return;
    await store(fileId, blob);
  } catch {
    // Leave the file as it was.
  } finally {
    if (heavy) heavyInFlight -= 1;
    else imagesInFlight -= 1;
  }
}
