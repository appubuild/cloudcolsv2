import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  await requireAdmin(req, "super_admin"); // audit is sensitive
  const admin = createAdminClient();
  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 100));
  const { data, error } = await admin.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: String(a.id),
    actorId: a.actor_id ? String(a.actor_id) : null,
    actorType: a.actor_type as "user" | "admin" | "system",
    action: String(a.action),
    targetType: String(a.target_type),
    targetId: String(a.target_id),
    metadata: a.metadata ?? {},
    createdAt: String(a.created_at),
  }));
});
