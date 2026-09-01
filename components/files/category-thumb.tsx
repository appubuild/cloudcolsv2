"use client";

import type { FileCategory } from "@/lib/types";
import { Image as ImageIcon, Video as VideoIcon, Music, FileText, FileArchive, File as FileIcon, FileType } from "lucide-react";
import { cn } from "@/lib/utils";

const config: Record<FileCategory, { icon: React.ReactNode; cls: string }> = {
  image: { icon: <ImageIcon className="h-5 w-5" />, cls: "bg-primary/10 text-primary" },
  video: { icon: <VideoIcon className="h-5 w-5" />, cls: "bg-violet-500/10 text-violet-500" },
  audio: { icon: <Music className="h-5 w-5" />, cls: "bg-amber-500/10 text-amber-500" },
  pdf: { icon: <FileText className="h-5 w-5" />, cls: "bg-error/10 text-error" },
  document: { icon: <FileText className="h-5 w-5" />, cls: "bg-sky-500/10 text-sky-500" },
  archive: { icon: <FileArchive className="h-5 w-5" />, cls: "bg-neutral-500/10 text-neutral-500" },
  other: { icon: <FileIcon className="h-5 w-5" />, cls: "bg-neutral-400/10 text-neutral-400" },
};

export function CategoryThumb({ category, className }: { category: FileCategory; className?: string }) {
  const c = config[category];
  return (
    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", c.cls, className)}>
      {c.icon}
    </span>
  );
}
