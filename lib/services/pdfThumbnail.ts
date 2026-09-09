"use client";

// A picture of a PDF's first page.
//
// PDFs were the worst tile in the grid: no thumbnail is generated for them, so every
// one drew the same red document glyph, and a folder of them was a wall of identical
// squares telling you nothing about which was which.
//
// pdf.js is the only way to rasterise a PDF in a browser, and it is a large library,
// so it is imported dynamically — nothing here is downloaded by someone who never
// touches a PDF. The import happens once per tab and is shared afterwards.
//
// Fails soft throughout, like every other thumbnail path: a PDF that will not
// rasterise (encrypted, corrupt, a codec pdf.js declines) keeps its category tile and
// nothing is said about it.

import { THUMBNAIL_MAX_EDGE, THUMBNAIL_QUALITY } from "@/lib/storage/derivatives";
import { deliveryCredentials } from "./deliveryFetch";

type PdfjsModule = typeof import("pdfjs-dist");

/** Resolved once per tab; the second PDF pays nothing for the library. */
let modulePromise: Promise<PdfjsModule | null> | null = null;

async function pdfjs(): Promise<PdfjsModule | null> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        const lib = await import("pdfjs-dist");
        // Rasterising a page is real work and belongs off the main thread, or the UI
        // stalls while a grid of PDFs renders. The bundler resolves this URL to the
        // worker it emitted alongside the library.
        lib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        return lib;
      } catch {
        return null;
      }
    })();
  }
  return modulePromise;
}

/** Scale so the longest edge is at most `max`, never scaling up. */
function scaleFor(width: number, height: number, max: number): number {
  const longest = Math.max(width, height);
  if (longest <= 0) return 0;
  return Math.min(1, max / longest);
}

/**
 * Renders page one of a PDF to a WebP blob.
 *
 * `source` is either the bytes — which is what the upload path has, already in
 * memory — or a URL, which is what the backfill path has. The URL form is the
 * interesting one: pdf.js reads it with HTTP range requests and `disableAutoFetch`
 * stops it pulling the rest of the document, so a 200-page report costs the first
 * few chunks rather than all of it. That only works because the delivery worker
 * honours ranges.
 */
export async function pdfFirstPageThumbnail(
  source: { data: ArrayBuffer } | { url: string },
): Promise<Blob | null> {
  const lib = await pdfjs();
  if (!lib) return null;

  let doc: Awaited<ReturnType<typeof lib.getDocument>["promise"]> | null = null;
  try {
    const task = lib.getDocument({
      ...("data" in source
        ? { data: new Uint8Array(source.data) }
        : {
            url: source.url,
            // Its range requests need the delivery cookie like any other read.
            withCredentials: deliveryCredentials(source.url) === "include",
          }),
      // Only the first page is wanted, so do not read ahead through the document.
      disableAutoFetch: true,
      disableStream: false,
      // A stored file is untrusted input, and XFA is a scripting-capable form layer
      // that drawing a page does not need.
      //
      // `isEvalSupported: false` used to sit here too. pdf.js removed the eval path
      // entirely in 5.7 — the option is gone from both the types and the build — so
      // there is nothing left to switch off.
      enableXfa: false,
    });
    doc = await task.promise;

    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = scaleFor(base.width, base.height, THUMBNAIL_MAX_EDGE);
    if (!scale) return null;

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // White behind the page. A PDF page is transparent where nothing is drawn, and a
    // WebP of black-on-transparent renders as an unreadable dark tile.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/webp", THUMBNAIL_QUALITY);
    });
  } catch {
    return null;
  } finally {
    try {
      await doc?.destroy();
    } catch {
      /* releasing the worker's copy is best-effort */
    }
  }
}
