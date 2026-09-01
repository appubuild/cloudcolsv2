import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  await admin.from("user_storage").delete().eq("user_id", user.id);
  await admin.auth.admin.deleteUser(user.id);
  return { deleted: true };
});
