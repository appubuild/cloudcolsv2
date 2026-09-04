"use client";

import {
  MoreVertical,
  Eye,
  Download,
  Share2,
  Pencil,
  Star,
  StarOff,
  FolderInput,
  Link2,
  ExternalLink,
  Trash2,
  Clock,
  Pin,
  Palette,
} from "lucide-react";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import type { FileListItem, File as CloudFile, Folder as CloudFolder } from "@/lib/types";
import { downloadFile, openFileInNewTab, copyItemLink } from "@/lib/services/fileActions";

export interface ItemMenuHandlers {
  onTogglePin?: (item: FileListItem) => void;
  onChangeIcon?: (item: FileListItem) => void;
  onOpen: (item: FileListItem) => void;
  onRename: (item: FileListItem) => void;
  onMove: (item: FileListItem) => void;
  onShare: (item: FileListItem) => void;
  onToggleFavorite: (item: FileListItem) => void;
  onDelete: (item: FileListItem) => void;
  onRestore?: (item: FileListItem) => void;
}

/**
 * The actions for one file or folder.
 *
 * Only what applies to the item is listed. A folder has no download and no
 * preview; a trashed item can only be restored or removed for good; and the
 * favourite entry says which way it will go rather than making the reader guess
 * from an icon.
 */
export function ItemMenu({
  item,
  isTrash = false,
  handlers,
}: {
  item: FileListItem;
  isTrash?: boolean;
  handlers: ItemMenuHandlers;
}) {
  const isFolder = "parentId" in item;
  const file = item as CloudFile;
  const folder = item as CloudFolder;
  const favorite = isFolder ? Boolean(folder.isFavorite) : Boolean(file.isFavorite);
  const linkPath = isFolder ? `/app/files/${folder.id}` : `/app/files?file=${file.id}`;

  return (
    <Dropdown
      trigger={
        <button
          onClick={(e) => e.stopPropagation()}
          aria-label="More actions"
          className="rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-surface-2 hover:text-foreground focus:opacity-100 group-hover:opacity-100 data-[open=true]:opacity-100"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      }
    >
      {isTrash ? (
        <>
          {handlers.onRestore && (
            <DropdownItem icon={<Clock className="h-4 w-4" />} onClick={() => handlers.onRestore!(item)}>
              Restore
            </DropdownItem>
          )}
          <DropdownItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => handlers.onDelete(item)}>
            Delete forever
          </DropdownItem>
        </>
      ) : (
        <>
          <DropdownItem icon={<Eye className="h-4 w-4" />} onClick={() => handlers.onOpen(item)}>
            {isFolder ? "Open" : "Preview"}
          </DropdownItem>

          {!isFolder && (
            <DropdownItem icon={<Download className="h-4 w-4" />} onClick={() => void downloadFile(file)}>
              Download
            </DropdownItem>
          )}

          <DropdownItem icon={<Share2 className="h-4 w-4" />} onClick={() => handlers.onShare(item)}>
            Share
          </DropdownItem>

          <DropdownItem icon={<Link2 className="h-4 w-4" />} onClick={() => void copyItemLink(linkPath)}>
            Copy link
          </DropdownItem>

          {!isFolder && (
            <DropdownItem
              icon={<ExternalLink className="h-4 w-4" />}
              onClick={() => void openFileInNewTab(file.id)}
            >
              Open in new tab
            </DropdownItem>
          )}

          <DropdownItem icon={<Pencil className="h-4 w-4" />} onClick={() => handlers.onRename(item)}>
            Rename
          </DropdownItem>

          <DropdownItem
            icon={favorite ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
            onClick={() => handlers.onToggleFavorite(item)}
          >
            {favorite ? "Remove from favourites" : "Add to favourites"}
          </DropdownItem>

          {isFolder && handlers.onTogglePin && (
            <DropdownItem
              icon={<Pin className="h-4 w-4" />}
              onClick={() => handlers.onTogglePin!(item)}
            >
              {folder.isPinned ? "Unpin folder" : "Pin to the top"}
            </DropdownItem>
          )}

          {isFolder && handlers.onChangeIcon && (
            <DropdownItem icon={<Palette className="h-4 w-4" />} onClick={() => handlers.onChangeIcon!(item)}>
              Change icon
            </DropdownItem>
          )}

          <DropdownItem icon={<FolderInput className="h-4 w-4" />} onClick={() => handlers.onMove(item)}>
            Move to…
          </DropdownItem>

          <DropdownItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => handlers.onDelete(item)}>
            Delete
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}
