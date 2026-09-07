"use client";

import { useState } from "react";
import type { FileCategory } from "@/lib/types";
import { CategoryThumb } from "./category-thumb";
import { useFileUrl } from "@/lib/hooks/useFileUrl";
import { cn } from "@/lib/utils";

/**
 * A file's thumbnail: the stored small version, or the category icon.
 *
 * `hasThumbnail` decides which. When the file has one, this asks for the derivative
 * — tens of kilobytes — instead of the original. Before thumbnails existed this
 * fetched the full file to draw a tile: an 877 KB photo downloaded to fill a 200 px
 * card, for every image in a folder, on every visit. That is object-storage egress
 * on the one path the architecture exists to keep cheap.
 *
 * Files uploaded before thumbnails, and anything whose thumbnail could not be
 * generated, fall back to the icon rather than to the original. Showing the real
 * picture at the cost of the whole file is the behaviour being removed, so it is not
 * the right fallback.
 *
 * Fetched lazily, so only cards scrolled into view ask for a URL at all. Anything
 * that fails — an expired URL, a derivative that is not there — falls back to the
 * icon rather than leaving a broken image in the grid.
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
  /** Whether the file has a stored derivative. Without one there is nothing to show. */
  hasThumbnail?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const wanted = Boolean(hasThumbnail) && !failed;

  const { data } = useFileUrl(fileId, wanted, "thumb");

  if (!wanted || !data?.url) {
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
