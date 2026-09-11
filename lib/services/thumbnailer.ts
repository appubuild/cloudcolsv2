"use client";

// Making a small version of a file, in the browser, before it is uploaded.
//
// Cloudflare Workers cannot resize an image: no ffmpeg, no native binaries, and Media
// Transformations only handles h.264 MP4 up to 40 MB. The browser already has the file
// in memory and already has a decoder for everything it can display, so it is the
// cheapest place this can happen — and it costs the server nothing at all.
//
// Everything here fails soft. A thumbnail is an optimisation; a file that cannot
// produce one uploads perfectly well and falls back to its category tile. Nothing in
// this module is allowed to make an upload fail.
//
// For video it takes an *early* frame and never scans forward looking for one. The
// candidates below are all within the first few seconds, tried in order, and the first
// that yields a picture with something in it wins. A file whose frames are all
// undecodable gives up after the timeout rather than working through the whole thing.

import { THUMBNAIL_MAX_EDGE, THUMBNAIL_QUALITY } from "@/lib/storage/derivatives";
import { pdfFirstPageThumbnail } from "./pdfThumbnail";

/** How long to give a video to produce a frame before abandoning it. */
const VIDEO_TIMEOUT_MS = 12_000;

/** The largest PDF that will be rasterised from memory during an upload. */
const PDF_INLINE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Where to look for a frame, in seconds, in order.
 *
 * All early, because the point is a picture of the video rather than a picture of a
 * particular moment in it, and because reaching further in costs more to decode.
 * Several of them because the first frame of a recording is very often black — a fade
 * in, a lens cap, a camera still metering — and a black tile reads as a broken one.
 */
const FRAME_CANDIDATES = [0.1, 1, 3, 0];

/** Scale so the longest edge is at most `max`, never scaling up. */
function fit(width: number, height: number, max: number): { w: number; h: number } {
  if (width <= 0 || height <= 0) return { w: 0, h: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

/** What a successful capture yields: the picture, and what the source turned out to be. */
export interface MediaThumbnail {
  blob: Blob;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

interface Drawn {
  blob: Blob | null;
  /** True when every sampled pixel is the same — a frame that had not arrived yet. */
  blank: boolean;
}

/**
 * Draws a source down to thumbnail size and encodes it.
 *
 * Also reports whether the result is a single flat colour. That is what an empty
 * decoder buffer looks like, and it is worth another timestamp rather than storing a
 * black rectangle and calling the file done.
 */
async function encode(source: CanvasImageSource, width: number, height: number): Promise<Drawn> {
  const { w, h } = fit(width, height, THUMBNAIL_MAX_EDGE);
  if (!w || !h) return { blob: null, blank: true };

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { blob: null, blank: true };
  ctx.drawImage(source, 0, 0, w, h);

  let blank = false;
  try {
    blank = isFlat(ctx, w, h);
  } catch {
    // A tainted canvas cannot be sampled. Not knowing is not a reason to reject the
    // picture — it just means the emptiness check is unavailable here.
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      // WebP everywhere it is supported; browsers that do not know it hand back PNG,
      // which is bigger but still far smaller than the original. The key says .webp
      // either way — it names the derivative, not a guarantee about the codec.
      canvas.toBlob((b) => resolve(b), "image/webp", THUMBNAIL_QUALITY);
    } catch {
      resolve(null);
    }
  });

  return { blob, blank };
}

/** Whether every sampled pixel is the same colour. Sampled, not exhaustive: a 512 px
 *  tile is a quarter of a million pixels and a grid of a few hundred answers it. */
function isFlat(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 12));
  const first = ctx.getImageData(0, 0, 1, 1).data;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const px = ctx.getImageData(x, y, 1, 1).data;
      // A tolerance, because compression and colour management move flat areas by a
      // point or two without making them interesting.
      if (
        Math.abs(px[0]! - first[0]!) > 6 ||
        Math.abs(px[1]! - first[1]!) > 6 ||
        Math.abs(px[2]! - first[2]!) > 6
      ) {
        return false;
      }
    }
  }
  return true;
}

async function fromImage(file: Blob): Promise<MediaThumbnail | null> {
  // createImageBitmap decodes off the main thread and handles orientation, which
  // <img> does not without extra work.
  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      const drawn = await encode(bitmap, bitmap.width, bitmap.height);
      return drawn.blob
        ? { blob: drawn.blob, width: bitmap.width, height: bitmap.height, durationSeconds: null }
        : null;
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
    const drawn = await encode(img, img.naturalWidth, img.naturalHeight);
    return drawn.blob
      ? { blob: drawn.blob, width: img.naturalWidth, height: img.naturalHeight, durationSeconds: null }
      : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resolves once the element has metadata, or null if it never will. */
function loadMetadata(video: HTMLVideoElement, url: string, deadline: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
    const settle = (ok: boolean) => {
      clearTimeout(timer);
      resolve(ok);
    };
    video.onerror = () => settle(false);
    video.onloadedmetadata = () => settle(true);
    video.src = url;
  });
}

/**
 * Seeks to `seconds` and waits for a frame to actually exist there.
 *
 * `seeked` says the seek finished, not that a picture has been decoded, so this also
 * requires `readyState` to say there is current data. Several events can be the moment
 * that becomes true and which one fires varies by browser and by file, so it listens
 * for all of them and takes whichever arrives.
 */
function seekAndWait(video: HTMLVideoElement, seconds: number, deadline: number): Promise<boolean> {
  return new Promise((resolve) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return resolve(false);

    const timer = setTimeout(() => settle(false), remaining);
    let done = false;
    function settle(ok: boolean) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.onseeked = null;
      video.onloadeddata = null;
      video.oncanplay = null;
      video.ontimeupdate = null;
      resolve(ok);
    }

    const check = () => {
      if (video.readyState >= 2) settle(true);
    };
    video.onseeked = check;
    video.onloadeddata = check;
    video.oncanplay = check;
    video.ontimeupdate = check;

    try {
      // Setting currentTime to the value it already holds fires no event at all, so a
      // target that happens to match would wait out the whole deadline.
      video.currentTime = Math.abs(video.currentTime - seconds) < 0.001 ? seconds + 0.05 : seconds;
    } catch {
      check();
    }
  });
}

/**
 * A frame from early in a video, and the video's shape and length.
 *
 * `source` is an object URL. For an upload that is the local file, so preloading is a
 * disk read and nothing more — which is why it asks for `auto` rather than `metadata`.
 * Only asking for metadata was what made a decoded frame uncertain, and it cost one
 * 331 MB video its thumbnail twice in a row on a perfectly ordinary H.264 track.
 */
export async function videoThumbnailFromUrl(
  url: string,
  opts: { crossOrigin?: "anonymous" | "use-credentials"; preload?: "auto" | "metadata" } = {},
): Promise<MediaThumbnail | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  // Local file: preload freely, it is a disk read. Remote: only the header, because
  // pulling more of a 900 MB film to draw a tile is the thing being avoided.
  video.preload = opts.preload ?? "auto";
  // Required, not cosmetic, when the bytes are remote: without it the canvas is
  // tainted by the draw and encoding the frame throws.
  if (opts.crossOrigin) video.crossOrigin = opts.crossOrigin;

  const deadline = Date.now() + VIDEO_TIMEOUT_MS;

  try {
    if (!(await loadMetadata(video, url, deadline))) return null;

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    const width = video.videoWidth || null;
    const height = video.videoHeight || null;
    // A video with no picture — an audio-only MP4, say — has nothing to draw.
    if (!width || !height) return null;

    // Never past the end of a short clip, and never the same instant twice.
    const targets = [...new Set(FRAME_CANDIDATES.filter((t) => duration === null || t < duration))];
    if (targets.length === 0) targets.push(0);

    let fallback: Blob | null = null;
    for (const target of targets) {
      if (Date.now() >= deadline) break;
      if (!(await seekAndWait(video, target, deadline))) continue;

      const drawn = await encode(video, width, height);
      if (!drawn.blob) continue;
      // A flat frame is kept only in case nothing better turns up — a video that
      // really is a solid colour should still get a tile.
      if (!drawn.blank) return { blob: drawn.blob, width, height, durationSeconds: duration };
      fallback ??= drawn.blob;
    }

    return fallback ? { blob: fallback, width, height, durationSeconds: duration } : null;
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      /* releasing the decoder is best-effort */
    }
  }
}

/** The same capture, for a file still in the browser rather than in storage. */
async function fromVideo(file: Blob): Promise<MediaThumbnail | null> {
  const url = URL.createObjectURL(file);
  try {
    return await videoThumbnailFromUrl(url, { preload: "auto" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A thumbnail for this file, or null if one cannot be made.
 *
 * Null is an ordinary outcome, not an error: a HEIC in a browser that cannot decode
 * it, a video in a codec it does not ship, a canvas that refuses in a private window.
 * The caller uploads the file regardless.
 */
export async function makeThumbnail(file: File): Promise<MediaThumbnail | null> {
  try {
    if (file.type.startsWith("image/")) return await fromImage(file);
    if (file.type.startsWith("video/")) return await fromVideo(file);
    // The bytes are already here, so the first page costs no network at all — the
    // backfill path is the one that has to range into storage for them.
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      if (file.size > PDF_INLINE_MAX_BYTES) return null;
      const blob = await pdfFirstPageThumbnail({ data: await file.arrayBuffer() });
      return blob ? { blob, width: null, height: null, durationSeconds: null } : null;
    }
    return null;
  } catch {
    return null;
  }
}

