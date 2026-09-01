import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";
import { mapUserProfile } from "@/lib/api/mappers";

export const dynamic = "force-dynamic";

// List accounts (metadata only — the admin has no content eye by default).
export const GET = handler(async (req: Request) => {
  const admin = await requireAdmin(req, "support");
  const client = createAdminClient();
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? "";
  const status = url.searchParams.get("status");

  let q = client.from("user_storage").select("user_id, plan_id, status, developer_enabled, storage_used_bytes, storage_quota_bytes, created_at, last_login_at");
  if (status) q = q.eq("status", status);

  const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
  if (error) throw error;

  // Resolve auth emails for the listed users.
  const ids = (data ?? []).map((u) => String(u.user_id));
  let emails: Record<string, string> = {};
  if (ids.length) {
    const { data: users } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    emails = Object.fromEntries((users?.users ?? []).filter((u) => ids.includes(u.id)).map((u) => [u.id, u.email ?? ""]));
  }

  let mapped = (data ?? [])
    .map((r) => mapUserProfile(r as Record<string, unknown>, { id: String(r.user_id), email: emails[String(r.user_id)] ?? "" }))
    .filter((u) => !search || u.email.toLowerCase().includes(search.toLowerCase()) || u.name.toLowerCase().includes(search.toLowerCase()));
  // Non-super admins see less sensitive account data.
  if (admin.role !== "super_admin") {
    mapped = mapped.map((u) => ({ ...u, email: u.email ? `${u.email.slice(0, 2)}•••@•••` : "" }));
  }
  return mapped;
});
