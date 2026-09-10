"use client";

// Making a small version of a file, in the browser, before it is uploaded.
//
// Cloudflare Workers cannot resize an image: no ffmpeg, no native binaries, and
// Media Transformations only handles h.264 MP4 up to 40 MB. The browser already has
// the file in memory and already has a decoder for everything it can display, so it
// is the cheapest place this can happen — and it costs the server nothing at all.
//
// Everything here fails soft. A thumbnail is an optimisation; a file that cannot
// produce one uploads perfectly well and falls back to its category icon. Nothing
// in this module is allowed to make an upload fail.

import { THUMBNAIL_MAX_EDGE, THUMBNAIL_QUALITY } from "@/lib/storage/derivatives";
import { pdfFirstPageThumbnail } from "./pdfThumbnail";

/**
 * How long to wait for a video to decode a frame before giving up on it.
 *
 * Twelve seconds rather than eight: a 300 MB file has to be indexed and seeked before
 * a frame exists, and a thumbnail that times out is indistinguishable from one that
 * was never possible.
 */
const VIDEO_TIMEOUT_MS = 12_000;

/**
 * The largest PDF that will be rasterised from memory during an upload.
 *
 * Unlike images and video, which are read through an object URL and decoded in
 * pieces, a PDF has to be handed to pdf.js as bytes — so the whole file lands in the
 * tab's memory. Above this the thumbnail is left to the backfill, which reads the
 * same document from storage with range requests and touches only the first page.
 */
const PDF_INLINE_MAX_BYTES = 64 * 1024 * 1024;

/** Scale so the longest edge is at most `max`, never scaling up. */
function fit(width: number, height: number, max: number): { w: number; h: number } {
  if (width <= 0 || height <= 0) return { w: 0, h: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

async function toWebp(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  const { w, h } = fit(width, height, THUMBNAIL_MAX_EDGE);
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);

  return new Promise<Blob | null>((resolve) => {
    // WebP everywhere it is supported; browsers that do not know it hand back PNG,
    // which is bigger but still far smaller than the original. The key says .webp
    // either way — it names the derivative, not a guarantee about the codec.
    canvas.toBlob((blob) => resolve(blob), "image/webp", THUMBNAIL_QUALITY);
  });
}

async function fromImage(file: File): Promise<Blob | null> {
  // createImageBitmap decodes off the main thread and handles orientation, which
  // <img> does not without extra work.
  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      return await toWebp(bitmap, bitmap.width, bitmap.height);
    } catch {
      return null;
    } finally {
      bitmap?.close();
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    return await toWebp(img, img.naturalWidth, img.naturalHeight);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fromVideo(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  /*
    "auto", not "metadata".

    This is an object URL over a file already on disk, so preloading costs a local read
    and no network at all — and "metadata" was the reason a frame sometimes never
    arrived. The browser reads the header, stops, and whether a later seek produces a
    decoded frame is then up to it. One 331 MB video failed twice in a row on a plain
    H.264 High profile track with ordinary AAC audio; nothing about the file explained
    it, because nothing about the file was wrong.

    The backfill still asks for "metadata", because there the bytes come over the wire
    and pulling more of a 900 MB film to draw a tile is the thing being avoided.
  */
  video.preload = "auto";

  try {
    const frame = await new Promise<HTMLVideoElement | null>((resolve) => {
      // A codec the browser cannot decode fires no useful event at all, so the whole
      // thing sits on a timer. Without it an undecodable video would hold the upload
      // queue open indefinitely.
      const timer = setTimeout(() => resolve(null), VIDEO_TIMEOUT_MS);
      let settled = false;
      const done = (value: HTMLVideoElement | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      video.onerror = () => done(null);

      /**
       * Whether a frame is actually there to draw.
       *
       * `seeked` says the seek finished, not that a picture has been decoded, and
       * drawing too early gives a blank canvas. `HAVE_CURRENT_DATA` is the readyState
       * that means there is one.
       */
      const drawWhenReady = () => {
        if (video.readyState >= 2) done(video);
      };

      video.onloadedmetadata = () => {
        // A frame one second in, or the middle of anything shorter. The first frame of
        // a video is very often black, which makes a thumbnail that looks broken.
        const duration = video.duration;
        const target =
          Number.isFinite(duration) && duration > 0 ? Math.min(1, duration / 2) : 0.1;

        video.onseeked = drawWhenReady;
        // Every one of these can be the moment the picture appears, and which fires
        // varies by browser and by file. Whichever comes first wins; `done` ignores
        // the rest.
        video.onloadeddata = drawWhenReady;
        video.oncanplay = drawWhenReady;
        video.ontimeupdate = drawWhenReady;

        try {
          // Setting currentTime to the value it already holds fires no `seeked` at
          // all, so a target of exactly 0 could wait out the whole timeout.
          video.currentTime = Math.abs(video.currentTime - target) < 0.001 ? target + 0.05 : target;
        } catch {
          // Seeking refused: the current frame, if there is one, is still worth having.
          drawWhenReady();
        }
      };

      video.src = url;
    });

    if (!frame) return null;
    return await toWebp(frame, frame.videoWidth, frame.videoHeight);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

/**
 * A thumbnail for this file, or null if one cannot be made.
 *
 * Null is an ordinary outcome, not an error: a HEIC in a browser that cannot decode
 * it, a video in a codec it does not ship, a canvas that refuses in a private
 * window. The caller uploads the file regardless.
 */
export async function makeThumbnail(file: File): Promise<Blob | null> {
  try {
    if (file.type.startsWith("image/")) return await fromImage(file);
    if (file.type.startsWith("video/")) return await fromVideo(file);
    // The bytes are already here, so the first page costs no network at all — the
    // backfill path is the one that has to range into storage for them.
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      if (file.size > PDF_INLINE_MAX_BYTES) return null;
      return await pdfFirstPageThumbnail({ data: await file.arrayBuffer() });
    }
    return null;
  } catch {
    return null;
  }
}
