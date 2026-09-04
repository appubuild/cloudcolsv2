"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  LayoutGrid,
  List,
  CheckSquare,
  Image as ImageIcon,
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
import { useTitleOverride } from "@/lib/page-title";
import { toast } from "@/lib/store/toast";
import { enqueueUploads } from "@/lib/services/uploadService";
import { filesRepo } from "@/lib/repositories";
import { FileCard } from "./file-card";
import { ItemMenu } from "./item-menu";
import { Breadcrumb } from "./breadcrumb";
import { EmptyState } from "./empty-state";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { Button } from "@/components/ui/button";
import { Skeleton, Badge } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
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
  const { invalidate, createFolder, rename, renameFolder, moveToFolder, toggleFavorite, toggleFolderFavorite, trash, restore, destroy } = useMutateFiles();
  const { data: trashData } = useTrash();

  const [sort, setSort] = useState<SortKey>("name");
  // A page at a time, so a folder with thousands of files does not try to render
  // all of them and does not fetch all of them either.
  const PAGE_SIZE = 24;
  const [page, setPage] = useState(1);
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
    const paging = { page, pageSize: PAGE_SIZE };
    if (mode === "browse") return { folderId: currentFolderId, sort, order, ...paging };
    if (mode === "category" && category) return { category, sort, order, ...paging };
    if (mode === "favorites") return { favoritesOnly: true, sort, order, ...paging };
    if (mode === "recent") return { recent: true, sort: "accessed", order: "desc", ...paging };
    if (mode === "search") return { search: debouncedSearch, sort, order, ...paging };
    return { sort, order, ...paging };
  }, [mode, category, currentFolderId, sort, order, debouncedSearch, page]);

  // Any change of what is being listed starts again at the first page; staying on
  // page 7 of a folder you just left shows an empty screen.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [mode, category, currentFolderId, debouncedSearch, sort, order]);

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

  // The route only knows "My Files"; the folder's name lives here.
  const setTitleOverride = useTitleOverride((st) => st.setOverride);
  useEffect(() => {
    if (mode === "browse" && crumbs.length > 1) setTitleOverride(crumbs[crumbs.length - 1]!.label);
    else if (mode === "search" && search) setTitleOverride(`Search: ${search}`);
    else setTitleOverride(null);
  }, [mode, crumbs, search, setTitleOverride]);

  const items = useMemo(() => (data?.items ?? []) as FileListItem[], [data]);
  const isTrashView = mode === "trash";
  const effectiveItems = isTrashView ? (trashData?.items ?? []) : items;
  const total = (isTrashView ? trashData?.total : data?.total) ?? effectiveItems.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const selectMany = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  /**
   * Bulk selection works over the items currently listed.
   *
   * Deliberately not "every match in the account": that would mean fetching every
   * row to collect ids, and an action on thousands of files chosen without seeing
   * them is not something to make easy. The category pages in the sidebar are the
   * way to narrow first, then select here.
   */
  const selectWhere = (predicate: (item: FileListItem) => boolean) => {
    setSelected((s) => {
      const next = new Set(s);
      for (const item of effectiveItems) if (predicate(item)) next.add(item.id);
      return next;
    });
  };

  const isFolderItem = (item: FileListItem) => "parentId" in item;

  /** Favourites the selected files. Folders have their own flag and their own action. */
  const favoriteSelected = async () => {
    const ids = effectiveItems
      .filter((i) => selected.has(i.id) && !isFolderItem(i) && !(i as File).isFavorite)
      .map((i) => i.id);
    if (ids.length === 0) {
      toast.info("Nothing to favourite", "The selected files are already favourites.");
      return;
    }
    await Promise.all(ids.map((id) => toggleFavorite.mutateAsync(id)));
    clearSelection();
  };

  /**
   * Downloads the selected files, one at a time.
   *
   * Sequential and paced on purpose: browsers block a page that starts many
   * downloads at once, and silently — the first two arrive and the rest do not.
   * There is no zip here because zipping would mean pulling every file through
   * the server, which is the one thing this architecture avoids.
   */
  const downloadSelected = async () => {
    const files = effectiveItems.filter((i) => selected.has(i.id) && !isFolderItem(i));
    if (files.length === 0) {
      toast.info("Nothing to download", "Folders cannot be downloaded yet.");
      return;
    }
    if (files.length > 1) {
      toast.info(`Downloading ${files.length} files`, "Your browser may ask permission for multiple downloads.");
    }
    for (const f of files) {
      try {
        const { url } = await filesRepo.getDownloadUrl("", f.id);
        const a = document.createElement("a");
        a.href = url;
        a.download = (f as File).originalFilename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise((r) => setTimeout(r, 400));
      } catch {
        toast.error("Download failed", (f as File).originalFilename);
      }
    }
    clearSelection();
  };
  const categoryOf = (item: FileListItem) => (isFolderItem(item) ? null : (item as File).category);

  /**
   * The actions behind each item's three-dot menu.
   *
   * Folders and files have separate favourite endpoints — folders were never
   * wired to theirs, so favouriting one did nothing at all.
   */
  const itemHandlers = {
    onOpen: (item: FileListItem) => openItem(item),
    onRename: (item: FileListItem) => {
      setRenameTarget(item);
      setRenameValue("parentId" in item ? (item as FolderType).name : (item as File).originalFilename);
    },
    onMove: (item: FileListItem) => setMoveTargets([item.id]),
    onShare: (item: FileListItem) => setShareTarget(item),
    onToggleFavorite: (item: FileListItem) => {
      if ("parentId" in item) toggleFolderFavorite.mutate(item.id);
      else toggleFavorite.mutate(item.id);
    },
    onDelete: (item: FileListItem) => setDeleteTargets([item.id]),
    onRestore: (item: FileListItem) => restore.mutate([item.id]),
  };

  const menuFor = (item: FileListItem) => (
    <ItemMenu item={item} isTrash={isTrashView} handlers={itemHandlers} />
  );

  const openItem = (item: FileListItem) => {
    if ("parentId" in item) {
      // Folder → navigate into it.
      router.push(`/app/files/${encodeURIComponent(item.id)}`);
      return;
    }
    setPreviewId(item.id);
  };

  const handleUpload = (files: FileList) => {
    // Pass the File objects themselves — the upload needs the bytes, not just
    // the name and size.
    enqueueUploads(Array.from(files).map((file) => ({ file, folderId: currentFolderId })));
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

  const selectedCount = selected.size;

  const body = (() => {
    if (isLoading)
      return (
        <div className={cn("grid gap-3", viewMode === "list" ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5")}>
          {Array.from({ length: viewMode === "list" ? 5 : 10 }).map((_, i) => (
            <Skeleton key={i} className={viewMode === "list" ? "h-12" : viewMode === "gallery" ? "h-40" : "h-28"} />
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
    if (viewMode === "gallery")
      return (
        // Fewer, wider columns than the compact grid: the preview is the content
        // here, so it gets the room.
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {effectiveItems.map((item) => (
            <FileCard
              key={item.id}
              item={item}
              variant="gallery"
              selected={selected.has(item.id)}
              onSelect={selectMany}
              onOpen={openItem}
              onContext={() => {}}
              menu={menuFor(item)}
            />
          ))}
        </div>
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
              menu={menuFor(item)}
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
            menu={menuFor(item)}
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
            <button onClick={() => setViewMode("gallery")} aria-label="Large preview" title="Large preview" className={cn("rounded p-1.5", viewMode === "gallery" ? "bg-surface text-primary shadow-sm" : "text-muted-foreground")}>
              <ImageIcon className="h-4 w-4" />
            </button>
            <button onClick={() => setViewMode("list")} aria-label="List view" className={cn("rounded p-1.5", viewMode === "list" ? "bg-surface text-primary shadow-sm" : "text-muted-foreground")}>
              <List className="h-4 w-4" />
            </button>
          </div>
          {effectiveItems.length > 0 && (
            <Dropdown
              trigger={
                <Button variant="ghost" size="sm">
                  <CheckSquare className="h-4 w-4" /> Select
                </Button>
              }
            >
              <DropdownItem onClick={() => selectWhere(() => true)}>
                All {effectiveItems.length} on this page
              </DropdownItem>
              <DropdownItem onClick={() => selectWhere(isFolderItem)}>All folders</DropdownItem>
              <DropdownItem onClick={() => selectWhere((i) => !isFolderItem(i))}>All files</DropdownItem>
              <DropdownItem onClick={() => selectWhere((i) => categoryOf(i) === "image")}>Images</DropdownItem>
              <DropdownItem onClick={() => selectWhere((i) => categoryOf(i) === "video")}>Videos</DropdownItem>
              <DropdownItem onClick={() => selectWhere((i) => categoryOf(i) === "audio")}>Audio</DropdownItem>
              <DropdownItem onClick={() => selectWhere((i) => categoryOf(i) === "document")}>Documents</DropdownItem>
              <DropdownItem onClick={() => selectWhere((i) => categoryOf(i) === "pdf")}>PDFs</DropdownItem>
              <DropdownItem onClick={() => selectWhere((i) => categoryOf(i) === "archive")}>Archives</DropdownItem>
              <DropdownItem onClick={clearSelection}>Clear selection</DropdownItem>
            </Dropdown>
          )}
          {selectedCount > 0 && <Badge tone="info">{selectedCount} selected</Badge>}
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary-soft p-2.5">
          {!isTrashView && (
            <>
              <Button variant="secondary" size="sm" onClick={() => void favoriteSelected()}>
                <Star className="h-4 w-4" /> Favorite
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void downloadSelected()}>
                <Download className="h-4 w-4" /> Download
              </Button>
            </>
          )}
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

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted-foreground tabular-nums">
            Page {page} of {pageCount} · {total} item{total === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
              Next
            </Button>
          </div>
        </div>
      )}

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
