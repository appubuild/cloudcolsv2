// Listing a folder tree as archive entries: a relative path and a URL for each file.
//
// Shared by the owner's route and the share-link route, which differ only in who is
// allowed and which delivery class the URLs use. The walk itself — subfolders, paths,
// paging — is the same, and two copies of it would be two chances to leak a file from
// outside the folder.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import type { Delivery } from "./delivery";

export interface ArchiveFolder {
  id: string;
  name: string;
}

export interface ArchiveEntry {
  fileId: string;
  /** Path inside the archive, relative to the folder being downloaded. */
  path: string;
  sizeBytes: number;
  url: string;
}

export interface ArchivePage {
  entries: ArchiveEntry[];
  /** Pass back to continue; null when the last file has been listed. */
  nextCursor: string | null;
  /** Only on the first page, and only when it could be counted cheaply. */
  fileCount?: number;
}

interface FileRow {
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType: string | null;
  objectKey: string;
}

export interface ArchiveRequest {
  ownerId: string;
  root: ArchiveFolder;
  cursor: string | null;
  /** Entries per page. Clamped; 0 or absent means the default. */
  limit?: number;
  countTotal?: boolean;
  deliver: (file: { objectKey: string; filename: string; mimeType: string | null }) => Promise<Delivery>;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
/** Folders visited per request, so a tree of empty folders still answers promptly. */
const MAX_FOLDERS_PER_PAGE = 25;
/** Lowest uuid, for "from the beginning" in a keyset scan. */
const FIRST_ID = "00000000-0000-0000-0000-000000000000";

/**
 * A name that is safe as one segment of a path inside a zip.
 *
 * Separators would create directories the listing did not describe, "." and ".." would
 * point outside the archive, and the characters Windows forbids make an entry that
 * cannot be extracted there at all.
 */
export function safeSegment(name: string): string {
  const cleaned = name
    .replace(/[\/]+/g, "-")
    .replace(/[:*?"<>|]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/^\.+$/, "_");
  return cleaned.slice(0, 180) || "unnamed";
}

/**
 * The folder and everything under it, in a stable order, with each one's path prefix.
 *
 * Walked here rather than with a recursive query because the folder rows are small and
 * few. `seen` is not decoration: a folder moved inside its own descendant makes a cycle,
 * and following one would produce an endless archive.
 */
async function folderTree(ownerId: string, root: ArchiveFolder): Promise<{ id: string; prefix: string }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("folders")
    .select("id, name, parent_id")
    .eq("owner_id", ownerId)
    .is("trashed_at", null);
  if (error) throw error;

  const children = new Map<string, { id: string; name: string }[]>();
  for (const row of data ?? []) {
    const parent = row.parent_id ? String(row.parent_id) : "";
    const list = children.get(parent) ?? [];
    list.push({ id: String(row.id), name: String(row.name) });
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const out: { id: string; prefix: string }[] = [{ id: root.id, prefix: "" }];
  const seen = new Set<string>([root.id]);
  for (let i = 0; i < out.length; i += 1) {
    const current = out[i]!;
    for (const child of children.get(current.id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push({ id: child.id, prefix: `${current.prefix}${safeSegment(child.name)}/` });
    }
  }
  return out;
}

async function filesIn(ownerId: string, folderId: string, afterId: string, limit: number): Promise<FileRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("files")
    .select("id, original_filename, size_bytes, mime_type, object_key")
    .eq("owner_id", ownerId)
    .eq("folder_id", folderId)
    .eq("status", "ready")
    .is("trashed_at", null)
    .gt("id", afterId || FIRST_ID)
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: String(r.id),
    filename: String(r.original_filename),
    sizeBytes: Number(r.size_bytes ?? 0),
    mimeType: r.mime_type ? String(r.mime_type) : null,
    objectKey: String(r.object_key),
  }));
}

async function countFiles(ownerId: string, folderIds: string[]): Promise<number | undefined> {
  const admin = createAdminClient();
  let total = 0;
  // In chunks: the ids travel in the query string, and a long one is refused.
  for (let i = 0; i < folderIds.length; i += 100) {
    const { count, error } = await admin
      .from("files")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .in("folder_id", folderIds.slice(i, i + 100))
      .eq("status", "ready")
      .is("trashed_at", null);
    if (error) return undefined;
    total += count ?? 0;
  }
  return total;
}

/**
 * One page of entries.
 *
 * The cursor is "<folder index>:<last file id>" — which folder of the walk, and how far
 * into it. Both halves are needed: paging on file id alone would need every file of the
 * tree in one query, and the id list for that does not fit in a request.
 */
export async function archiveEntries(req: ArchiveRequest): Promise<ArchivePage> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, req.limit || DEFAULT_LIMIT));
  const folders = await folderTree(req.ownerId, req.root);

  const [rawIndex, rawAfter] = (req.cursor ?? "").split(":");
  let index = Number(rawIndex) || 0;
  let after = rawAfter ?? "";
  if (index < 0 || index >= folders.length) index = folders.length;

  const entries: ArchiveEntry[] = [];
  let nextCursor: string | null = null;
  let foldersVisited = 0;

  while (index < folders.length && entries.length < limit) {
    if (foldersVisited >= MAX_FOLDERS_PER_PAGE) {
      nextCursor = `${index}:${after}`;
      break;
    }
    const folder = folders[index]!;
    const remaining = limit - entries.length;
    const rows = await filesIn(req.ownerId, folder.id, after, remaining);
    foldersVisited += 1;

    for (const row of rows) {
      const delivery = await req.deliver({ objectKey: row.objectKey, filename: row.filename, mimeType: row.mimeType });
      entries.push({
        fileId: row.id,
        path: `${folder.prefix}${safeSegment(row.filename)}`,
        sizeBytes: row.sizeBytes,
        url: delivery.url,
      });
    }

    if (rows.length === remaining) {
      // The folder may hold more; resume inside it.
      after = rows[rows.length - 1]!.id;
      nextCursor = `${index}:${after}`;
      break;
    }
    index += 1;
    after = "";
    nextCursor = index < folders.length ? `${index}:` : null;
  }

  if (index >= folders.length) nextCursor = null;

  return {
    entries,
    nextCursor,
    ...(req.countTotal ? { fileCount: await countFiles(req.ownerId, folders.map((f) => f.id)) } : {}),
  };
}
