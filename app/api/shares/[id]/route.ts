import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const PATCH = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("share_links")
    .update({ is_revoked: true })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("SHARE_NOT_FOUND", 404, "Share link not found.");
  return { revoked: true };
});
