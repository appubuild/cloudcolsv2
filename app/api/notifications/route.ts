import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    type: String(r.type ?? "info"),
    title: String(r.title),
    body: String(r.body),
    isRead: Boolean(r.is_read),
    createdAt: String(r.created_at),
    link: r.link ? String(r.link) : null,
  }));
});
