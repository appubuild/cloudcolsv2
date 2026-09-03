"use client";

import type { File as FileType, FileListItem, Folder as FolderType, FileCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatBytes, formatDate } from "@/lib/utils";
import { FileThumb } from "./file-thumb";
import { Folder as FolderIcon, Star } from "lucide-react";

const catLabel: Record<FileCategory, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  document: "Document",
  archive: "Archive",
  other: "File",
};

export function FileCard({
  item,
  selected,
  onSelect,
  onOpen,
  onContext,
  grid = true,
  variant = grid ? "grid" : "list",
}: {
  item: FileListItem;
  selected?: boolean;
  onSelect: (id: string) => void;
  onOpen: (item: FileListItem) => void;
  onContext: (item: FileListItem, e: React.MouseEvent) => void;
  grid?: boolean;
  variant?: "grid" | "list" | "gallery";
}) {
  const isFolder = "parentId" in item;
  const file = item as FileType;
  const folder = item as FolderType;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={selected}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item);
        }
      }}
      onContextMenu={(e) => onContext(item, e)}
      className={cn(
        "group relative select-none rounded-lg border transition-colors",
        grid ? "p-3" : "",
        selected
          ? "border-primary bg-primary-soft/60"
          : isFolder
            ? "border-border bg-surface hover:border-primary/40 hover:bg-surface-2"
            : "border-border bg-surface hover:border-primary/40 hover:bg-surface-2"
      )}
    >
      {/* Checkbox for selection */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect(item.id);
        }}
        aria-label={selected ? "Deselect" : "Select"}
        className={cn(
          "absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border transition",
          selected ? "border-primary bg-primary text-white" : "border-border bg-surface opacity-0 group-hover:opacity-100"
        )}
      >
        {selected && (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {variant === "gallery" ? (
        <div className="flex flex-col">
          {/* A tall preview so images are recognisable at a glance, which a 40px
              icon beside the name never is. */}
          {isFolder ? (
            <span className="flex h-[104px] w-full items-center justify-center rounded-md bg-primary-soft text-primary">
              <FolderIcon className="h-9 w-9" />
            </span>
          ) : (
            <FileThumb
              fileId={file.id}
              category={file.category}
              alt={file.originalFilename}
              className="h-[104px] w-full rounded-md"
            />
          )}
          <div className="mt-2 flex items-start gap-1.5">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {isFolder ? folder.name : file.originalFilename}
            </p>
            {!isFolder && file.isFavorite && (
              <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isFolder ? "Folder" : `${catLabel[file.category]} · ${formatBytes(file.sizeBytes)}`}
          </p>
        </div>
      ) : variant === "grid" ? (
        <div className="flex flex-col">
          <div className="flex items-center gap-2.5">
            {isFolder ? (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <FolderIcon className="h-5 w-5" />
              </span>
            ) : (
              categoryMedia(file)
            )}
            {file.isFavorite && (
              <Star className="ml-auto ml-0 h-4 w-4 shrink-0 fill-amber-400 text-amber-400" />
            )}
          </div>
          <p className="mt-2.5 truncate text-sm font-medium text-foreground">{isFolder ? folder.name : file.originalFilename}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isFolder ? "Folder" : `${catLabel[file.category]} · ${formatBytes(file.sizeBytes)}`}
          </p>
          <p className="text-[11px] text-muted-foreground/70">{formatDate(isFolder ? folder.updatedAt : file.updatedAt)}</p>
        </div>
      ) : (
        // List row
        <div className="flex items-center gap-3">
          {isFolder ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
              <FolderIcon className="h-4 w-4" />
            </span>
          ) : (
            categoryMedia(file, 8)
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {isFolder ? folder.name : file.originalFilename}
          </span>
          <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">
            {isFolder ? "—" : formatBytes(file.sizeBytes)}
          </span>
          <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground md:block">
            {formatDate(isFolder ? folder.updatedAt : file.updatedAt)}
          </span>
          {file.isFavorite && <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" />}
        </div>
      )}
    </div>
  );
}

function categoryMedia(file: FileType, size = 6) {
  return (
    <FileThumb
      fileId={file.id}
      category={file.category}
      alt={file.originalFilename}
      className={cn("h-11 w-11", size === 8 && "h-8 w-8")}
    />
  );
}
