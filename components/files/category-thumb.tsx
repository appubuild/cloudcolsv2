"use client";

import type { FileCategory } from "@/lib/types";
import {
  Image as ImageIcon,
  Video as VideoIcon,
  Music,
  FileText,
  FileArchive,
  File as FileIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The tile shown for a file with no picture of its own.
 *
 * Every category gets its own glyph and its own colour, because this is the only
 * thing telling someone what a file is when there is no thumbnail — a PDF, a
 * spreadsheet and a zip should not be three identical grey squares.
 */
const config: Record<FileCategory, { Icon: LucideIcon; cls: string }> = {
  image: { Icon: ImageIcon, cls: "bg-primary/10 text-primary" },
  video: { Icon: VideoIcon, cls: "bg-violet-500/10 text-violet-500" },
  audio: { Icon: Music, cls: "bg-amber-500/10 text-amber-500" },
  pdf: { Icon: FileText, cls: "bg-error/10 text-error" },
  document: { Icon: FileText, cls: "bg-sky-500/10 text-sky-500" },
  archive: { Icon: FileArchive, cls: "bg-neutral-500/10 text-neutral-500" },
  other: { Icon: FileIcon, cls: "bg-neutral-400/10 text-neutral-400" },
};

export function CategoryThumb({
  category,
  className,
}: {
  category: FileCategory;
  className?: string;
}) {
  const { Icon, cls } = config[category];

  return (
    <span
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg",
        cls,
        className,
      )}
    >
      {/*
        Sized against the tile rather than fixed.

        The same component draws a 32 px row icon and a 104 px gallery card. At a fixed
        20 px the large card was a small glyph adrift in an empty rectangle, which read
        as a thumbnail that had failed to load rather than as a file of a known type —
        which is exactly what people reported about PDFs.
      */}
      {category === "video" ? (
        // A play button rather than the film icon, and in the same place the badge sits
        // once the video has a real frame behind it — so a video reads as a video
        // whether or not its thumbnail has been generated yet.
        <span className="flex h-[45%] max-h-10 min-h-5 w-[45%] max-w-10 min-w-5 items-center justify-center rounded-full bg-violet-500/20 ring-1 ring-violet-500/40">
          <svg viewBox="0 0 24 24" aria-hidden className="h-1/2 w-1/2 translate-x-[6%]" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      ) : (
        <Icon className="h-[45%] max-h-10 min-h-4 w-[45%] max-w-10 min-w-4" strokeWidth={1.75} />
      )}
    </span>
  );
}
