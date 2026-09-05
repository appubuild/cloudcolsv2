import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// List accounts (metadata only — the admin has no content eye by default).
export const GET = handler(async (req: Request) => {
  const admin = await requireAdmin(req, "support");
  const client = createAdminClient();
  const url = new URL(req.url);
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  const status = url.searchParams.get("status");
  const plan = url.searchParams.get("plan");
  const sort = url.searchParams.get("sort") ?? "created";
  const order = (url.searchParams.get("order") ?? "desc") === "asc";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Number(url.searchParams.get("pageSize") ?? 25));

  // Mapped, so a caller-supplied string cannot become a column name.
  const SORT: Record<string, string> = {
    created: "created_at",
    storage: "storage_used_bytes",
    lastLogin: "last_login_at",
    plan: "plan_id",
  };

  let q = client
    .from("user_storage")
    .select(
      "user_id, plan_id, status, developer_enabled, storage_used_bytes, storage_quota_bytes, created_at, last_login_at, display_name",
      { count: "exact" },
    );
  if (status) q = q.eq("status", status);
  if (plan) q = q.eq("plan_id", plan);

  // Searching by email needs the auth table, which is not joinable from here, so
  // a search fetches a wider page and filters after resolving addresses. Without
  // a search the database does the paging, which is what matters for a large
  // account list.
  const searching = Boolean(search);
  const from = searching ? 0 : (page - 1) * pageSize;
  const to = searching ? 999 : page * pageSize - 1;

  const { data, count, error } = await q
    .order(SORT[sort] ?? SORT.created, { ascending: order, nullsFirst: false })
    .range(from, to);
  if (error) throw error;

  const rows = data ?? [];
  const ids = rows.map((u) => String(u.user_id));

  let emails: Record<string, string> = {};
  if (ids.length) {
    const { data: users } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    emails = Object.fromEntries(
      (users?.users ?? []).filter((u) => ids.includes(u.id)).map((u) => [u.id, u.email ?? ""]),
    );
  }

  let mapped = rows.map((r) => ({
    id: String(r.user_id),
    email: emails[String(r.user_id)] ?? "",
    name: r.display_name ? String(r.display_name) : (emails[String(r.user_id)] ?? "").split("@")[0] ?? "User",
    planId: String(r.plan_id ?? "plan_free"),
    status: String(r.status ?? "active"),
    developerEnabled: Boolean(r.developer_enabled),
    storageUsedBytes: Number(r.storage_used_bytes ?? 0),
    storageQuotaBytes: Number(r.storage_quota_bytes ?? 0),
    createdAt: r.created_at ? String(r.created_at) : null,
    lastLoginAt: r.last_login_at ? String(r.last_login_at) : null,
  }));

  let total = count ?? mapped.length;
  if (searching) {
    mapped = mapped.filter(
      (u) => u.email.toLowerCase().includes(search) || u.name.toLowerCase().includes(search),
    );
    total = mapped.length;
    mapped = mapped.slice((page - 1) * pageSize, page * pageSize);
  }

  // Support can act on an account without needing to read the address.
  if (admin.role !== "super_admin") {
    mapped = mapped.map((u) => ({ ...u, email: u.email ? `${u.email.slice(0, 2)}•••@•••` : "" }));
  }

  return { items: mapped, total, page, pageSize };
});
