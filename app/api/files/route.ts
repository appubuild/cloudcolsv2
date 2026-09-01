import "server-only";
import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { mapFile, mapFolder } from "@/lib/api/mappers";

export const dynamic = "force-dynamic";

// List files + folder contents for the authenticated user.
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const folderId = url.searchParams.get("folderId");
  const category = url.searchParams.get("category");
  const search = url.searchParams.get("search");
  const favoritesOnly = url.searchParams.get("favoritesOnly") === "true";
  const recent = url.searchParams.get("recent") === "true";
  const sort = url.searchParams.get("sort") ?? "modified";
  const order = (url.searchParams.get("order") ?? "desc").toUpperCase();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Number(url.searchParams.get("pageSize") ?? 36));

  const admin = createAdminClient();
  const base = admin.from("files").select("*").eq("owner_id", user.id);

  // Folder listing returns both folders + files in the folder.
  let folders: unknown[] = [];
  if (folderId === "null" || folderId === null) {
    const fn = admin.from("folders").select("*").eq("owner_id", user.id).is("parent_id", null).is("trashed_at", null);
    folders = ((await fn).data ?? []) as unknown[];
  } else if (folderId) {
    const fn = admin.from("folders").select("*").eq("owner_id", user.id).eq("parent_id", folderId).is("trashed_at", null);
    folders = ((await fn).data ?? []) as unknown[];
  }

  let query = base;
  if (folderId === "null" || folderId === null) query = query.is("folder_id", null);
  else if (folderId) query = query.eq("folder_id", folderId);
  query = query.is("trashed_at", null);
  if (category) query = query.eq("category", category);
  if (favoritesOnly) query = query.eq("is_favorite", true);
  if (recent) query = query.not("last_accessed_at", "is", null).order("last_accessed_at", { ascending: false });
  if (search) query = query.ilike("original_filename", `%${search}%`);

  query = query.order(sort === "name" ? "original_filename" : sort, { ascending: order === "ASC" });

  const { data: files, error } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;

  const mappedFiles = (files ?? []).map((r) => mapFile(r as Record<string, unknown>));
  const mappedFolders = (folders ?? []).map((r) => mapFolder(r as Record<string, unknown>));
  // Only return folders when not categorizing / searching / favoriting / recent.
  const includeFolders = !category && !search && !favoritesOnly && !recent;
  const items = includeFolders ? [...mappedFolders, ...mappedFiles] : mappedFiles;

  return {
    items: items.slice(0, pageSize),
    total: items.length,
    page,
    pageSize,
  };
});
