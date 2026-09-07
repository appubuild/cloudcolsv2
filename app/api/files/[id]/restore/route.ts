import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { mapFile } from "@/lib/api/mappers";

export const dynamic = "force-dynamic";

type Params = { id: string };

// POST /api/files/:id/restore — restore a trashed file.
export const POST = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const admin = createAdminClient();
  // maybeSingle: `single()` treats "no rows" as PGRST116, which this rethrows — so an
  // ownership miss answered 500 with a Postgres error code, and the 404 below could
  // never run.
  const { data, error } = await admin
    .from("files")
    .update({ trashed_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");
  return mapFile(data);
});
