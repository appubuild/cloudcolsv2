"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  LayoutGrid,
  List,
  ArrowUpDown,
  Pencil,
  Trash2,
  Copy,
  FolderPlus,
  Star,
  Download,
  Share2,
  Eye,
  Library,
  Clock,
  X,
  Folder,
} from "lucide-react";
import type { File, FileCategory, FileListParams, FileListItem, Folder as FolderType } from "@/lib/types";
import { useFiles, useTrash, useFolders, useMutateFiles, useShare } from "@/lib/hooks/queries";
import { useUiStore } from "@/lib/store/ui";
import { toast } from "@/lib/store/toast";
import { enqueueUploads } from "@/lib/services/uploadService";
import { FileCard } from "./file-card";
import { Breadcrumb } from "./breadcrumb";
import { EmptyState } from "./empty-state";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { Button } from "@/components/ui/button";
import { Skeleton, Badge } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { PreviewPortal } from "@/components/preview/preview-portal";

type Mode = "browse" | "recent" | "favorites" | "category" | "trash" | "search";
type SortKey = "name" | "size" | "modified" | "accessed";

const CATEGORY_LABEL: Record<FileCategory, string> = {
  image: "Images",
  video: "Videos",
  audio: "Audio",
  pdf: "PDF",
  document: "Documents",
  archive: "Archives",
  other: "Other",
};

export function FileManager({
  mode = "browse",
  category,
  folderPath = [],
  search,
}: {
  mode?: Mode;
  category?: FileCategory;
  folderPath?: string[];
  search?: string;
}) {
  const router = useRouter();
  const { viewMode, setViewMode } = useUiStore();
  const { invalidate, createFolder, rename, renameFolder, moveToFolder, toggleFavorite, trash, restore, destroy } = useMutateFiles();
  const { data: trashData } = useTrash();

  const [sort, setSort] = useState<SortKey>("name");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<FileListItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveTargets, setMoveTargets] = useState<string[]>([]);
  const [deleteTargets, setDeleteTargets] = useState<string[]>([]);
  const [shareTarget, setShareTarget] = useState<FileListItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Debounce search so we don't fire a query per keystroke (optimization).
  const debouncedSearch = useDebouncedValue(search ?? "", 300);

  // Folder navigation resolves the current folder id by walking the path.
  const currentFolderId = useMemo(() => {
    if (mode !== "browse" || folderPath.length === 0) return null;
    return folderPath.length ? folderPath[folderPath.length - 1] : null;
  }, [mode, folderPath]);

  const params = useMemo<FileListParams>(() => {
    if (mode === "browse") return { folderId: currentFolderId, sort, order };
    if (mode === "category" && category) return { category, sort, order };
    if (mode === "favorites") return { favoritesOnly: true, sort, order };
    if (mode === "recent") return { recent: true, sort: "accessed", order: "desc" };
    if (mode === "search") return { search: debouncedSearch, sort, order };
    return { sort, order };
  }, [mode, category, currentFolderId, sort, order, debouncedSearch]);

  const { data, isLoading, isError, error } = useFiles(params);
  const { data: allFolders } = useFolders();

  const crumbs = useMemo(() => {
    if (mode === "recent") return [{ label: "Recent" }];
    if (mode === "favorites") return [{ label: "Favorites" }];
    if (mode === "category" && category) return [{ label: CATEGORY_LABEL[category] }];
    if (mode === "trash") return [{ label: "Trash" }];
    if (mode === "search") return [{ label: `Search: ${search}` }];
    const segs = [{ label: "My Files", href: "/app/files" }];
    const byId = new Map((allFolders ?? []).map((f) => [f.id, f]));
    let acc = "/app/files";
    folderPath.forEach((seg) => {
      acc += `/${seg}`;
      segs.push({ label: byId.get(seg)?.name ?? seg, href: acc });
    });
    return segs;
  }, [mode, category, folderPath, search, allFolders]);

  const items = useMemo(() => (data?.items ?? []) as FileListItem[], [data]);
  const isTrashView = mode === "trash";

  const selectMany = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const openItem = (item: FileListItem) => {
    if ("parentId" in item) {
      // Folder → navigate into it.
      router.push(`/app/files/${encodeURIComponent(item.id)}`);
      return;
    }
    setPreviewId(item.id);
  };

  const handleUpload = (files: FileList) => {
    const list = Array.from(files).map((f) => ({ name: f.name, size: f.size, mimeType: f.type || undefined, folderId: currentFolderId }));
    enqueueUploads(list);
  };

  // Window-level drag/drop detection so files can be dropped anywhere.
  useEffect(() => {
    let depth = 0;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        depth += 1;
        setDragOver(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files") && depth > 0) {
        depth -= 1;
        if (depth <= 0) {
          depth = 0;
          setDragOver(false);
        }
      }
    };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      setDragOver(false);
      const files = e.dataTransfer?.files;
      if (files?.length) handleUpload(files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder("asc");
    }
  };

  const effectiveItems = isTrashView ? (trashData?.items ?? []) : items;
  const selectedCount = selected.size;

  const body = (() => {
    if (isLoading)
      return (
        <div className={cn("grid gap-3", viewMode === "grid" ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" : "grid-cols-1")}>
          {Array.from({ length: viewMode === "grid" ? 10 : 5 }).map((_, i) => (
            <Skeleton key={i} className={viewMode === "grid" ? "h-28" : "h-12"} />
          ))}
        </div>
      );
    if (isError)
      return (
        <EmptyState
          icon={<X className="h-7 w-7" />}
          title="Something went wrong"
          description={(error as Error)?.message ?? "Could not load your files."}
          action={<Button onClick={() => invalidate()}>Retry</Button>}
        />
      );
    if (effectiveItems.length === 0)
      return (
        <EmptyState
          icon={isTrashView ? <Trash2 className="h-7 w-7" /> : <Library className="h-7 w-7" />}
          title={isTrashView ? "Trash is empty" : mode === "search" ? `No results for "${search}"` : "This folder is empty"}
          description={
            isTrashView
              ? "Deleted items appear here and are permanently removed after 30 days."
              : "Drag and drop files here, or upload from your device."
          }
          action={
            !isTrashView ? (
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> Upload files
              </Button>
            ) : undefined
          }
        />
      );
    if (viewMode === "grid")
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {effectiveItems.map((item) => (
            <FileCard
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              onSelect={selectMany}
              onOpen={openItem}
              onContext={() => {}}
            />
          ))}
        </div>
      );
    return (
      <div className="grid grid-cols-1 gap-1.5">
        {effectiveItems.map((item) => (
          <FileCard
            key={item.id}
            item={item}
            grid={false}
            selected={selected.has(item.id)}
            onSelect={selectMany}
            onOpen={openItem}
            onContext={() => {}}
          />
        ))}
      </div>
    );
  })();

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) handleUpload(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Breadcrumb crumbs={crumbs} />
        <div className="flex items-center gap-2">
          {!isTrashView && (
            <Button variant="secondary" size="sm" onClick={() => setCreateFolderOpen(true)}>
              <FolderPlus className="h-4 w-4" /> New folder
            </Button>
          )}
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" /> Upload
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => toggleSort("name")} className={cn(sort === "name" && "bg-surface-2")}>
            <ArrowUpDown className="h-3.5 w-3.5" /> Name
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggleSort("size")} className={cn(sort === "size" && "bg-surface-2")}>
            Size
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggleSort("modified")} className={cn(sort === "modified" && "bg-surface-2")}>
            Modified
          </Button>
          <Button variant="ghost" size="sm" onClick={() => toggleSort("accessed")} className={cn(sort === "accessed" && "bg-surface-2")}>
            Accessed
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md bg-surface-2 p-0.5">
            <button onClick={() => setViewMode("grid")} aria-label="Grid view" className={cn("rounded p-1.5", viewMode === "grid" ? "bg-surface text-primary shadow-sm" : "text-muted-foreground")}>
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button onClick={() => setViewMode("list")} aria-label="List view" className={cn("rounded p-1.5", viewMode === "list" ? "bg-surface text-primary shadow-sm" : "text-muted-foreground")}>
              <List className="h-4 w-4" />
            </button>
          </div>
          {selectedCount > 0 && <Badge tone="info">{selectedCount} selected</Badge>}
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary-soft p-2.5">
          <Button variant="secondary" size="sm" onClick={() => setMoveTargets(Array.from(selected))}>
            <Copy className="h-4 w-4" /> Move
          </Button>
          {isTrashView ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => { restore.mutate(Array.from(selected)); clearSelection(); }}>
                <Clock className="h-4 w-4" /> Restore
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setDeleteTargets(Array.from(selected))}>
                <Trash2 className="h-4 w-4" /> Delete forever
              </Button>
            </>
          ) : (
            <Button variant="destructive" size="sm" onClick={() => setDeleteTargets(Array.from(selected))}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={clearSelection}>
            <X className="h-4 w-4" /> Clear
          </Button>
        </div>
      )}

      {body}

      {/* Drag & drop layer */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-primary/10">
          <div className="rounded-lg border-2 border-dashed border-primary bg-surface px-10 py-8 text-center shadow-elevated">
            <Upload className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-2 font-medium">Drop to upload</p>
          </div>
        </div>
      )}

      <Dialog open={createFolderOpen} onClose={() => setCreateFolderOpen(false)} title="New folder">
        <Label htmlFor="nf">Folder name</Label>
        <Input
          id="nf"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          placeholder="e.g. Project Archive"
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreateFolderOpen(false)}>Cancel</Button>
          <Button
            onClick={() =>
              createFolder.mutate(
                { parentId: currentFolderId, name: newFolderName },
                {
                  onSuccess: () => {
                    toast.success("Folder created", newFolderName);
                    setNewFolderName("");
                    setCreateFolderOpen(false);
                  },
                  onError: (e) => toast.error("Could not create folder", (e as Error).message),
                }
              )
            }
            loading={createFolder.isPending}
          >
            Create
          </Button>
        </div>
      </Dialog>

      <Dialog open={!!renameTarget} onClose={() => setRenameTarget(null)} title="Rename" description={renameTarget ? ("name" in renameTarget ? (renameTarget as FolderType).name : (renameTarget as File).originalFilename) : ""}>
        <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</Button>
          <Button
            onClick={() => {
              const target = renameTarget!;
              const m = "parentId" in target ? renameFolder : rename;
              m.mutate(
                { folderId: target.id, name: renameValue, fileId: target.id } as never,
                {
                  onSuccess: () => {
                    toast.success("Renamed", renameValue);
                    setRenameTarget(null);
                  },
                  onError: (e) => toast.error("Rename failed", (e as Error).message),
                }
              );
            }}
            loading={rename.isPending || renameFolder.isPending}
          >
            Save
          </Button>
        </div>
      </Dialog>

      <MoveDialog
        open={moveTargets.length > 0}
        onClose={() => setMoveTargets([])}
        onMove={(target) =>
          moveToFolder.mutate(
            { ids: moveTargets, target },
            {
              onSuccess: () => {
                toast.success("Moved", `${moveTargets.length} item(s) moved`);
                setMoveTargets([]);
              },
              onError: (e) => toast.error("Move failed", (e as Error).message),
            }
          )
        }
      />

      <Dialog
        open={deleteTargets.length > 0}
        onClose={() => setDeleteTargets([])}
        title={isTrashView ? "Delete permanently?" : "Move to trash?"}
        description={isTrashView ? "This action cannot be undone." : "Deleted items move to Trash and can be restored within 30 days."}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteTargets([])}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => {
              const m = isTrashView ? destroy : trash;
              m.mutate(deleteTargets, {
                onSuccess: () => {
                  toast.success(isTrashView ? "Deleted permanently" : "Moved to trash", isTrashView ? undefined : "You can restore from Trash.");
                  clearSelection();
                  setDeleteTargets([]);
                },
              });
            }}
            loading={trash.isPending || destroy.isPending}
          >
            {isTrashView ? "Delete forever" : "Move to trash"}
          </Button>
        </div>
      </Dialog>

      <ShareDialog item={shareTarget} onClose={() => setShareTarget(null)} />
      <PreviewPortal fileId={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}

function MoveDialog({
  open,
  onClose,
  onMove,
}: {
  open: boolean;
  onClose: () => void;
  onMove: (targetFolderId: string | null) => void;
}) {
  const { data } = useFiles({ folderId: null, sort: "name", order: "asc" });
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  return (
    <Dialog open={open} onClose={onClose} title="Move to…" description="Choose a destination folder.">
      <div className="max-h-72 space-y-1 overflow-auto rounded-md border border-border p-2">
        <button
          onClick={() => setSelectedFolder(null)}
          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm", selectedFolder === null ? "bg-primary-soft text-primary" : "text-foreground hover:bg-surface-2")}
        >
          <Library className="h-4 w-4" /> My Files (root)
        </button>
        {(data?.items ?? []).filter((i): i is FolderType => "parentId" in i).map((i) => (
          <button
            key={i.id}
            onClick={() => setSelectedFolder(i.id)}
            className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm", selectedFolder === i.id ? "bg-primary-soft text-primary" : "text-foreground hover:bg-surface-2")}
          >
            <Folder className="h-4 w-4" />
            {i.name}
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onMove(selectedFolder)}>Move here</Button>
      </div>
    </Dialog>
  );
}

function ShareDialog({ item, onClose }: { item: FileListItem | null; onClose: () => void }) {
  const { create } = useShare();
  const [permission, setPermission] = useState<"view" | "download">("download");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const displayName = item ? ("name" in item ? (item as FolderType).name : (item as File).originalFilename) : "";

  return (
    <Dialog open={!!item} onClose={onClose} title="Share" description={`Create a link to share "${displayName}"`}>
      {createdToken ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Your link is ready. Anyone with the link can access this{item && "file"} {permission === "download" ? "and download it" : "(view only)"}.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-2">
            <code className="flex-1 truncate text-xs">{`${typeof window !== "undefined" ? window.location.origin : ""}/s/${createdToken}`}</code>
            <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/s/${createdToken}`); toast.success("Link copied"); }}>
              Copy
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Label>Access</Label>
            <Tabs
              tabs={[
                { id: "view", label: "View only" },
                { id: "download", label: "Download allowed" },
              ]}
              value={permission}
              onChange={(v) => setPermission(v as "view" | "download")}
              className="mt-2"
            />
          </div>
          <p className="text-xs text-muted-foreground">Share links are secure and can be revoked anytime from the Shared section.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => {
                if (!item) return;
                create.mutate(
                  {
                    fileId: "parentId" in item ? undefined : item.id,
                    folderId: "parentId" in item ? item.id : undefined,
                    permission,
                  },
                  {
                    onSuccess: (link) => setCreatedToken(link.token),
                    onError: (e) => toast.error("Could not create link", (e as Error).message),
                  }
                );
              }}
              loading={create.isPending}
            >
              Create link
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
