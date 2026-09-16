import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { devRoute, devOptions, pageParams, publicFile } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** Sort keys a caller may name, mapped to real columns — never the column itself. */
const SORT: Record<string, string> = {
  name: "original_filename",
  size: "size_bytes",
  created: "created_at",
  modified: "updated_at",
};

/** GET /v1/files — the account's files, filtered and paged. */
export const GET = devRoute({ scope: "files.read" }, async (req, { identity }) => {
  const url = new URL(req.url);
  const { limit, offset } = pageParams(url);
  const category = url.searchParams.get("type");
  const folderId = url.searchParams.get("folderId");
  const search = url.searchParams.get("search");
  const sort = SORT[url.searchParams.get("sort") ?? "modified"] ?? SORT.modified!;
  const ascending = (url.searchParams.get("order") ?? "desc").toLowerCase() === "asc";

  let query = createAdminClient()
    .from("files")
    .select("*", { count: "exact" })
    // The key's account, never an id from the request.
    .eq("owner_id", identity.userId)
    .eq("status", "ready")
    .is("trashed_at", null);

  if (category) query = query.eq("category", category);
  if (folderId) query = folderId === "null" ? query.is("folder_id", null) : query.eq("folder_id", folderId);
  if (search) query = query.ilike("original_filename", `%${search}%`);

  const { data, count, error } = await query.order(sort, { ascending }).range(offset, offset + limit - 1);
  if (error) throw error;

  return {
    files: (data ?? []).map((r) => publicFile(r as Record<string, unknown>)),
    total: count ?? 0,
    limit,
    offset,
  };
});

export const OPTIONS = devOptions();
