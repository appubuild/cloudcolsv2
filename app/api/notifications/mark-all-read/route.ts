import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  await admin.from("notifications").update({ is_read: true }).eq("user_id", user.id);
  return { ok: true };
});
