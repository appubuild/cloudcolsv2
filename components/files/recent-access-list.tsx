"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Folder as FolderIcon, Star, Clock } from "lucide-react";
import { FileThumb } from "./file-thumb";
import { Skeleton } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { PreviewPortal } from "@/components/preview/preview-portal";
import { useMutateFiles } from "@/lib/hooks/queries";
import { formatBytes, formatRelative } from "@/lib/utils";
import type { File, FileListItem, Folder } from "@/lib/types";

function isFile(item: FileListItem): item is File {
  return "sizeBytes" in item;
}

/**
 * The dashboard's list of recently opened things.
 *
 * A row opens what it names: a file previews in place, a folder navigates. Both used
 * to be links, and the file one pointed at `/app/recent` — the same list, one page
 * over — so clicking a file you had just been reading took you to a list of files you
 * had just been reading. It looked like a working link and did nothing.
 */
export function RecentAccessList({
  items,
  loading,
  limit = 5,
}: {
  items: FileListItem[];
  loading?: boolean;
  limit?: number;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<File | null>(null);
  const { toggleFavorite, toggleFolderFavorite } = useMutateFiles();

  const open = (item: FileListItem) => {
    // The whole file, not just its id: the portal then has everything it needs and
    // skips a round trip for facts this row already displayed.
    if (isFile(item)) setPreview(item);
    else router.push(`/app/files/${encodeURIComponent(item.id)}`);
  };

  return (
    <>
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
                const favorite = file ? (item as File).isFavorite : (item as Folder).isFavorite;

                return (
                  <div key={item.id} className="group flex items-center gap-3 py-2.5">
                    {/* The whole row is the target, not just the filename. A single
                        line of text is a hard thing to hit, and the thumbnail beside
                        it is the part people actually aim at. */}
                    <button
                      type="button"
                      onClick={() => open(item)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      {file ? (
                        <FileThumb fileId={item.id} category={item.category} alt={item.originalFilename} hasThumbnail={Boolean(item.thumbnailUrl)} className="h-9 w-9" />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                          <FolderIcon className="h-5 w-5" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">
                          {file ? (item as File).originalFilename : (item as Folder).name}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {file
                            ? `${formatBytes((item as File).sizeBytes)} · ${formatRelative((item as File).lastAccessedAt)}`
                            : `Folder · ${formatRelative((item as Folder).lastAccessedAt)}`}
                        </span>
                      </span>
                    </button>

                    {/* This actually favourites now. It was wired to a route push, so
                        a control labelled "Toggle favorite" and drawn as a star
                        navigated away instead, and nothing was ever favourited here. */}
                    <button
                      type="button"
                      aria-label={favorite ? "Remove from favourites" : "Add to favourites"}
                      aria-pressed={favorite}
                      onClick={() => (file ? toggleFavorite.mutate(item.id) : toggleFolderFavorite.mutate(item.id))}
                      className={
                        favorite
                          ? "rounded-md p-1 text-amber-500"
                          : "rounded-md p-1 text-muted-foreground/40 opacity-0 transition hover:text-amber-500 focus-visible:opacity-100 group-hover:opacity-100"
                      }
                    >
                      <Star className={favorite ? "h-4 w-4 fill-amber-400 text-amber-400" : "h-4 w-4"} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Outside the Card, not inside it. The overlay is position:fixed, so it works
          either way today — but a Card that later gains `overflow-hidden` or a
          transform would start clipping it, and that failure stays invisible until
          somebody opens a preview from this list. */}
      <PreviewPortal fileId={preview?.id ?? null} file={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function EmptyRecent() {
  return (
    <div className="py-8 text-center">
      <Clock className="mx-auto h-8 w-8 text-muted-foreground/40" />
      <p className="mt-2 text-sm text-muted-foreground">Nothing opened yet.</p>
    </div>
  );
}
