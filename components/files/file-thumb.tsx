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
 *   2. an image with no derivative — the original, as it was before thumbnails
 *      existed, and a derivative is generated from it in the background so this is
 *      the last time it costs that much
 *   3. anything else — the category icon
 *
 * Case 2 exists because of a regression I introduced. When thumbnails arrived, this
 * component started requiring one, and every file uploaded before that day — which
 * was all of them — silently turned into a generic icon. The pictures had been
 * showing; they stopped. Falling back to the original is no worse than the behaviour
 * it replaced, and the backfill means each file pays it once.
 */
export function FileThumb({
  fileId,
  category,
  alt,
  className,
  hasThumbnail,
}: {
  fileId: string;
  category: FileCategory;
  alt: string;
  className?: string;
  /** Whether the file has a stored derivative. */
  hasThumbnail?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const isImage = category === "image";
  const stored = Boolean(hasThumbnail);

  // An image without a derivative still gets a picture, from the original.
  const wantOriginal = isImage && !stored && !failed;
  const want = (stored || wantOriginal) && !failed;

  const { data } = useFileUrl(fileId, want, stored ? "thumb" : "full");

  // One attempt per file per page, whatever else re-renders.
  const attempted = useRef(false);
  useEffect(() => {
    if (!wantOriginal || !data?.url || attempted.current) return;
    attempted.current = true;
    void backfillThumbnail(fileId, data.url);
  }, [wantOriginal, data?.url, fileId]);

  if (!want || !data?.url) {
    return <CategoryThumb category={category} className={className} />;
  }

  return (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed
          URL on a third-party origin; the Next image optimiser cannot fetch it. */}
      <img
        src={data.url}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}
