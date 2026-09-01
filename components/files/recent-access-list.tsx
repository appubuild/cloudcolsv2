"use client";

import Link from "next/link";
import { Folder as FolderIcon, Star, Clock } from "lucide-react";
import { CategoryThumb } from "./category-thumb";
import { Skeleton } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { formatBytes, formatRelative } from "@/lib/utils";
import type { File, FileListItem, Folder } from "@/lib/types";

function isFile(item: FileListItem): item is File {
  return "sizeBytes" in item;
}

export function RecentAccessList({
  items,
  loading,
  onToggleFavorite,
  limit = 5,
}: {
  items: FileListItem[];
  loading?: boolean;
  onToggleFavorite?: (id: string) => void;
  limit?: number;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between p-5 pb-2">
        <h3 className="text-base font-semibold text-foreground">Recent access</h3>
        <Link href="/app/recent" className="text-sm font-medium text-primary hover:underline">View all</Link>
      </div>
      <div className="px-5 pb-5">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : items.length === 0 ? (
          <EmptyRecent />
        ) : (
          <div className="divide-y divide-border">
            {items.slice(0, limit).map((item) => {
              const file = isFile(item);
              return (
                <div key={item.id} className="group flex items-center gap-3 py-2.5">
                  {file ? (
                    <CategoryThumb category={item.category} className="h-9 w-9" />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                      <FolderIcon className="h-5 w-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <Link
                      href={file ? "/app/recent" : `/app/files/${encodeURIComponent(item.id)}`}
                      className="block truncate text-sm font-medium text-foreground hover:text-primary"
                    >
                      {file ? (item as File).originalFilename : (item as Folder).name}
                    </Link>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {file
                        ? `${formatBytes((item as File).sizeBytes)} · ${formatRelative((item as File).lastAccessedAt)}`
                        : `Folder · ${formatRelative((item as Folder).lastAccessedAt)}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle favorite"
                    onClick={() => onToggleFavorite?.(item.id)}
                    className="rounded-md p-1 text-muted-foreground/40 opacity-0 transition hover:text-amber-500 group-hover:opacity-100"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

function EmptyRecent() {
  return (
    <div className="py-8 text-center">
      <FolderIcon className="mx-auto h-8 w-8 text-muted-foreground/30" />
      <p className="mt-2 text-sm text-muted-foreground">Nothing here yet.</p>
      <p className="text-xs text-muted-foreground/70">
        Files and folders you open will show up here.
      </p>
    </div>
  );
}
