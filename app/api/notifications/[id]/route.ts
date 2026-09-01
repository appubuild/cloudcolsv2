import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const PATCH = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const admin = createAdminClient();
  await admin.from("notifications").update({ is_read: true }).eq("id", id).eq("user_id", user.id);
  return { ok: true };
});
