"use client";

// Downloading a folder: the browser builds the zip.
//
// The server lists the folder's files with a short-lived URL each
// (/api/folders/[id]/archive); this reads them from the CDN and writes a zip as the
// bytes arrive. Where the browser supports it the archive is written straight to the
// file the user picked, so a 50 GB folder costs no more memory than a small one — and
// no file byte ever passes through our servers, which is the rule the product is built
// on and the reason "download folder" sat unavailable for so long.
//
// Where File System Access is missing (Firefox, Safari) the zip is assembled in memory
// and saved at the end; the caller is told, because for a large folder that matters.

import { downloadZip } from "client-zip";
import { apiClient } from "@/lib/api/client";
import { deliveryCredentials } from "./deliveryFetch";

export interface ArchiveEntry {
  fileId: string;
  path: string;
  sizeBytes: number;
  url: string;
}

interface ArchivePage {
  folderName: string;
  entries: ArchiveEntry[];
  nextCursor: string | null;
  fileCount?: number;
}

export interface ZipProgress {
  /** Files written so far. */
  files: number;
  /** Total files, once known. */
  totalFiles?: number;
  bytes: number;
  /** True while the archive is held in memory rather than written to disk. */
  inMemory: boolean;
}

export interface FolderZipSource {
  /** Fetches one page of entries. */
  page(cursor: string | null): Promise<ArchivePage>;
  /** Suggested file name, without the .zip. */
  name: string;
}

/** The owner's own folder. */
export function ownFolderSource(folderId: string, folderName: string): FolderZipSource {
  return {
    name: folderName,
    page: (cursor) =>
      apiClient.get<ArchivePage>(`/api/folders/${encodeURIComponent(folderId)}/archive${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  };
}

/** A folder someone was sent a link to. */
export function sharedFolderSource(token: string, folderName: string): FolderZipSource {
  return {
    name: folderName,
    page: (cursor) =>
      apiClient.get<ArchivePage>(
        `/api/shares/archive?token=${encodeURIComponent(token)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
  };
}

/** Names inside a zip must be unique; two files can legitimately share one. */
function uniqueName(path: string, taken: Set<string>): string {
  if (!taken.has(path)) {
    taken.add(path);
    return path;
  }
  const dot = path.lastIndexOf(".");
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

async function fetchEntry(entry: ArchiveEntry, refresh: () => Promise<string | null>): Promise<Response> {
  const attempt = async (url: string) => fetch(url, { credentials: deliveryCredentials(url) });
  let res = await attempt(entry.url);
  if (res.ok) return res;

  // A long download can outlive the URLs listed at the start. One refresh, then give up
  // on this file rather than the whole archive.
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const fresh = await refresh();
    if (fresh) {
      res = await attempt(fresh);
      if (res.ok) return res;
    }
  }
  throw new Error(`Could not read ${entry.path} (${res.status})`);
}

/**
 * Streams the folder into a zip.
 *
 * `pickTarget` must be called from the click itself — a browser only opens a save
 * dialog while a gesture is still fresh, and the first network call would spend it.
 */
export async function downloadFolderZip(
  source: FolderZipSource,
  options: { onProgress?: (p: ZipProgress) => void; signal?: AbortSignal } = {},
): Promise<{ files: number; bytes: number; inMemory: boolean }> {
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  const suggestedName = `${source.name || "folder"}.zip`;

  let handle: FileSystemFileHandle | null = null;
  if (picker) {
    try {
      handle = await picker.call(window, {
        suggestedName,
        types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }],
      });
    } catch (e) {
      // The dialog was dismissed: that is a cancellation, not a failure.
      if ((e as DOMException)?.name === "AbortError") throw e;
      handle = null;
    }
  }

  const inMemory = !handle;
  const taken = new Set<string>();
  const progress: ZipProgress = { files: 0, bytes: 0, inMemory };

  // Remembers where each entry came from, so one can be re-listed if its URL expires.
  const pageCursors = new Map<string, string | null>();

  async function refreshUrl(entry: ArchiveEntry): Promise<string | null> {
    const cursor = pageCursors.get(entry.fileId) ?? null;
    try {
      const again = await source.page(cursor);
      return again.entries.find((e) => e.fileId === entry.fileId)?.url ?? null;
    } catch {
      return null;
    }
  }

  async function* files() {
    let cursor: string | null = null;
    let total: number | undefined;
    do {
      const requested: string | null = cursor;
      const page: ArchivePage = await source.page(requested);
      if (page.fileCount !== undefined) total = page.fileCount;
      for (const entry of page.entries) {
        if (options.signal?.aborted) return;
        pageCursors.set(entry.fileId, requested);
        const res = await fetchEntry(entry, () => refreshUrl(entry));
        progress.files += 1;
        progress.bytes += entry.sizeBytes;
        options.onProgress?.({ ...progress, totalFiles: total });
        yield { name: uniqueName(entry.path, taken), input: res };
      }
      cursor = page.nextCursor;
    } while (cursor);
  }

  const zipped = downloadZip(files());

  if (handle) {
    const writable = await handle.createWritable();
    await zipped.body!.pipeTo(writable, { signal: options.signal });
  } else {
    const blob = await zipped.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return { files: progress.files, bytes: progress.bytes, inMemory };
}
