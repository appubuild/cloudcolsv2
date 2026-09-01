import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  await requireAdmin(req, "support");
  const admin = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [users, totalFilesRes, subsRes, payRes, apiRes] = await Promise.all([
    admin.from("user_storage").select("user_id, plan_id, status, created_at, storage_used_bytes, storage_quota_bytes"),
    admin.from("files").select("id", { count: "exact", head: true }),
    admin.from("subscriptions").select("id, status, plan_id").eq("status", "active"),
    admin.from("payments").select("amount_cents, status").eq("status", "succeeded"),
    admin.from("api_request_logs").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
  ]);

  const rows = users.data ?? [];
  const active = rows.filter((u) => u.status === "active").length;
  const new7d = rows.filter((u) => u.created_at && new Date(u.created_at) >= new Date(sevenDaysAgo)).length;
  const mrr = (payRes.data ?? []).reduce((sum, p) => sum + Number(p.amount_cents), 0);

  return {
    totalUsers: rows.length,
    activeUsers: active,
    newSignups7d: new7d,
    totalFiles: totalFilesRes.count ?? 0,
    storageUsedBytes: rows.reduce((sum, u) => sum + Number(u.storage_used_bytes ?? 0), 0),
    activeSubscriptions: (subsRes.data ?? []).length,
    mrrCents: mrr,
    apiRequests7d: apiRes.count ?? 0,
  };
});
