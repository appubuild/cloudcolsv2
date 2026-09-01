"use client";

import Link from "next/link";
import { Folder as FolderIcon, Star } from "lucide-react";
import type { Folder } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

const FOLDER_TINTS = [
  "bg-indigo-500/10 text-indigo-500",
  "bg-emerald-500/10 text-emerald-500",
  "bg-amber-500/10 text-amber-500",
  "bg-rose-500/10 text-rose-500",
  "bg-sky-500/10 text-sky-500",
  "bg-violet-500/10 text-violet-500",
];

function tintFor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % FOLDER_TINTS.length;
  return FOLDER_TINTS[h];
}

export function FolderCard({
  folder,
  onToggleFavorite,
  compact = false,
}: {
  folder: Folder;
  onToggleFavorite?: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="cc-lift group relative flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 hover:border-primary/30 hover:shadow-sm">
      <button
        type="button"
        aria-label={folder.isFavorite ? "Remove from favorites" : "Add to favorites"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite?.(folder.id);
        }}
        className={cn(
          "absolute right-3 top-3 z-10 rounded-md p-1 text-muted-foreground/50 transition hover:bg-surface-2 hover:text-foreground",
          folder.isFavorite && "text-amber-500 hover:text-amber-500"
        )}
      >
        <Star className={cn("h-4 w-4", folder.isFavorite && "fill-amber-500")} />
      </button>

      <div className={cn("flex h-11 w-11 items-center justify-center rounded-lg", tintFor(folder.name))}>
        <FolderIcon className="h-6 w-6" />
      </div>

      <div className="min-w-0">
        <Link href={`/app/files/${encodeURIComponent(folder.id)}`} className="block truncate text-sm font-medium text-foreground hover:text-primary">
          {folder.name}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {compact ? formatDate(folder.lastAccessedAt ?? folder.updatedAt) : folder.path}
        </p>
      </div>

      {/* Hover-actions overflow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-surface/60 opacity-0 backdrop-blur-sm transition group-hover:pointer-events-auto group-hover:opacity-100">
        <Link
          href={`/app/files/${encodeURIComponent(folder.id)}`}
          onClick={(e) => e.stopPropagation()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-primary/90"
        >
          Open
        </Link>
      </div>
    </div>
  );
}
