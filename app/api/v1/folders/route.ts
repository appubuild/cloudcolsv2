import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { devRoute, devOptions, pageParams, publicFolder } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /v1/folders — the account's folders. `?parentId=` lists one level. */
export const GET = devRoute({ scope: "files.read" }, async (req, { identity }) => {
  const url = new URL(req.url);
  const { limit, offset } = pageParams(url);
  const parentId = url.searchParams.get("parentId");

  let query = createAdminClient()
    .from("folders")
    .select("*", { count: "exact" })
    .eq("owner_id", identity.userId)
    .is("trashed_at", null);

  if (parentId) query = parentId === "null" ? query.is("parent_id", null) : query.eq("parent_id", parentId);

  const { data, count, error } = await query.order("name").range(offset, offset + limit - 1);
  if (error) throw error;

  return {
    folders: (data ?? []).map((r) => publicFolder(r as Record<string, unknown>)),
    total: count ?? 0,
    limit,
    offset,
  };
});

export const OPTIONS = devOptions();
