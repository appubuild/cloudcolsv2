"use client";

import { useEffect, useRef, useState } from "react";
import type { FileCategory } from "@/lib/types";
import { CategoryThumb } from "./category-thumb";
import { useFileUrl } from "@/lib/hooks/useFileUrl";
import { backfillThumbnail } from "@/lib/services/thumbnailBackfill";
import { cn } from "@/lib/utils";

/**
 * A file's thumbnail.
 *
 * Three cases, in order of what they cost:
 *
 *   1. a stored derivative — tens of kilobytes, which is the whole point
 *   2. an image or video with no derivative — read from the original once, to make
 *      one, so this is the last time it costs that much
 *   3. anything else — the category tile
 *
 * Case 2 exists because of a regression I introduced. When thumbnails arrived, this
 * component started requiring one, and every file uploaded before that day — which
 * was all of them — silently turned into a generic icon. The pictures had been
 * showing; they stopped.
 *
 * Images and videos are read differently in that case, and the difference matters.
 * An image is fetched whole, because it is already small enough to be a thumbnail's
 * source. A video is not fetched at all: the URL is handed to a video element, which
 * ranges into it for the few megabytes around one frame. Downloading a 900 MB film to
 * draw a 104 px tile is exactly what the architecture forbids, so it does not.
 */
export function FileThumb({
  fileId,
  category,
  alt,
  className,
  hasThumbnail,
  src,
}: {
  fileId: string;
  category: FileCategory;
  alt: string;
  className?: string;
  /** Whether the file has a stored derivative. */
  hasThumbnail?: boolean;
  /**
   * A signed URL for that derivative, when the listing already supplied one.
   *
   * This is the difference between a grid that draws and a grid that first asks the
   * API forty times what its own pictures are called.
   */
  src?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const stored = Boolean(hasThumbnail);
  const isImage = category === "image";
  const isVideo = category === "video";
  const isPdf = category === "pdf";

  // An image with no derivative still gets a picture: the original is displayable as
  // it stands. A video's original is not, so it only gets read to make a thumbnail.
  const showsOriginal = isImage && !stored;
  const backfills = (isImage || isVideo || isPdf) && !stored;

  // Nothing to fetch when the listing handed the URL over, which is the common case.
  const wantsUrl = !src && (stored || showsOriginal || backfills) && !failed;
  // "source" rather than "full": this is the app reading bytes to make a derivative,
  // not the person opening a file, and Recent Access should not fill up with tiles
  // that happened to scroll past.
  const variant = stored ? "thumb" : "source";
  const { data } = useFileUrl(fileId, wantsUrl, variant);
  const pictureUrl = src ?? data?.url ?? null;

  // One attempt per file per page, whatever else re-renders.
  const attempted = useRef(false);
  useEffect(() => {
    if (!backfills || src || !data?.url || attempted.current) return;
    attempted.current = true;
    void backfillThumbnail(fileId, data.url, isVideo ? "video" : isPdf ? "pdf" : "image");
  }, [backfills, src, data?.url, fileId, isVideo, isPdf]);

  const showsPicture = (stored || showsOriginal) && !failed && Boolean(pictureUrl);

  if (!showsPicture) {
    return <CategoryThumb category={category} className={className} />;
  }

  return (
    <span
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed
          URL on a third-party origin; the Next image optimiser cannot fetch it. */}
      <img
        src={pictureUrl!}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
      {isVideo && <PlayBadge />}
    </span>
  );
}

/**
 * The play glyph over a video's thumbnail.
 *
 * A video thumbnail is a still frame, so without this it is indistinguishable from a
 * photograph — the tile tells you what the file looks like and not what it is.
 *
 * Sized in relative units against the tile, so the same component reads correctly on
 * a 32 px row icon and a 104 px gallery card. `pointer-events-none` because the tile
 * behind it is what handles the click.
 */
function PlayBadge() {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="flex h-[38%] max-h-9 min-h-4 w-[38%] max-w-9 min-w-4 items-center justify-center rounded-full bg-black/45 backdrop-blur-[1px] ring-1 ring-white/25">
        <svg viewBox="0 0 24 24" aria-hidden className="h-1/2 w-1/2 translate-x-[6%] text-white" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </span>
  );
}
