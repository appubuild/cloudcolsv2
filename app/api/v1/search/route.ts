import "server-only";
import { ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { devRoute, devOptions, pageParams, publicFile } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /v1/search?q=… — the account's files by name, optionally narrowed by type. */
export const GET = devRoute({ scope: "files.read" }, async (req, { identity }) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) throw new ApiError("INVALID_INPUT", 400, "q is required.");

  const { limit, offset } = pageParams(url);
  const category = url.searchParams.get("type");

  let query = createAdminClient()
    .from("files")
    .select("*", { count: "exact" })
    .eq("owner_id", identity.userId)
    .eq("status", "ready")
    .is("trashed_at", null)
    // The term is a value, never part of the SQL: % and _ inside it are escaped so a
    // search for "100%" does not become a wildcard.
    .ilike("original_filename", `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`);

  if (category) query = query.eq("category", category);

  const { data, count, error } = await query.order("updated_at", { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw error;

  return {
    query: q,
    files: (data ?? []).map((r) => publicFile(r as Record<string, unknown>)),
    total: count ?? 0,
    limit,
    offset,
  };
});

export const OPTIONS = devOptions();
