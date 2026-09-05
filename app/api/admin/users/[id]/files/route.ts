import "server-only";
import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";
import { mapFile, mapFolder } from "@/lib/api/mappers";

export const dynamic = "force-dynamic";

type Params = { id: string };

const SORT_COLUMNS: Record<string, string> = {
  name: "original_filename",
  modified: "updated_at",
  created: "created_at",
  size: "size_bytes",
};

/**
 * One account's files, for an admin.
 *
 * The same shape the user's own file list returns, so the admin browser can reuse
 * the file-manager components rather than growing a second, subtly different way
 * of showing the same thing.
 *
 * Paged, because an account with fifty thousand files is exactly the account an
 * admin is most likely to be looking at.
 */
export const GET = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  await requireAdmin(req, "support");
  const { id: ownerId } = (await ctx?.params) ?? { id: "" };

  const url = new URL(req.url);
  const folderId = url.searchParams.get("folderId");
  const category = url.searchParams.get("category");
  const search = url.searchParams.get("search");
  const sort = url.searchParams.get("sort") ?? "modified";
  const order = (url.searchParams.get("order") ?? "desc").toUpperCase();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Number(url.searchParams.get("pageSize") ?? 30));

  const client = createAdminClient();

  let folders: unknown[] = [];
  if (!category && !search) {
    const q = client
      .from("folders")
      .select("*")
      .eq("owner_id", ownerId)
      .is("trashed_at", null);
    const { data } = folderId ? await q.eq("parent_id", folderId) : await q.is("parent_id", null);
    folders = data ?? [];
  }

  let files = client.from("files").select("*", { count: "exact" }).eq("owner_id", ownerId).is("trashed_at", null);
  if (folderId) files = files.eq("folder_id", folderId);
  else if (!category && !search) files = files.is("folder_id", null);
  if (category) files = files.eq("category", category);
  if (search) files = files.ilike("original_filename", `%${search}%`);

  // Mapped through the same table as the user-facing list, so an unknown sort key
  // cannot become a column name.
  files = files.order(SORT_COLUMNS[sort] ?? SORT_COLUMNS.modified, { ascending: order === "ASC" });

  const { data, count, error } = await files.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;

  const items = [
    ...folders.map((f) => mapFolder(f as Record<string, unknown>)),
    ...(data ?? []).map((f) => mapFile(f as Record<string, unknown>)),
  ];

  return { items, total: count ?? items.length, page, pageSize };
});
