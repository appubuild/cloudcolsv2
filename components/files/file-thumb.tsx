"use client";

import { useState } from "react";
import type { FileCategory } from "@/lib/types";
import { CategoryThumb } from "./category-thumb";
import { useFileUrl } from "@/lib/hooks/useFileUrl";
import { cn } from "@/lib/utils";

/**
 * A file's thumbnail: the picture itself for images, the category icon otherwise.
 *
 * The image is fetched lazily, so only cards actually scrolled into view ask the
 * server for a signed URL. That still means fetching the full image to draw it
 * small — there is no stored thumbnail yet, and a Worker cannot resize one. The
 * right fix is to generate a small version in the browser at upload time and
 * store it alongside the file; until then this is honest about showing the real
 * picture rather than a placeholder with the filename drawn on it.
 *
 * Anything that fails — an expired URL, a file that is not really an image, mock
 * mode where there are no bytes at all — falls back to the icon rather than
 * leaving a broken image in the grid.
 */
export function FileThumb({
  fileId,
  category,
  alt,
  className,
}: {
  fileId: string;
  category: FileCategory;
  alt: string;
  className?: string;
}) {
  const isImage = category === "image";
  const [failed, setFailed] = useState(false);

  const { data } = useFileUrl(fileId, isImage && !failed);

  if (!isImage || failed || !data?.url) {
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
