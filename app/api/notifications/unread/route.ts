import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data } = await admin
    .from("notifications")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_read", false);
  return { count: (data ?? []).length };
});
