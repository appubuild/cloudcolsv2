import "server-only";
import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Who can sign in to the admin panel, and with what role.
 *
 * The Security screen used to print a fixed list of five roles — Super Admin,
 * Support, Billing, Content, Auditor — three of which have never existed. The
 * roles the server actually enforces are super_admin, support and operator, and
 * the people holding them are rows in `admins`. Showing the real ones means the
 * screen can be used to answer "who has access", which was the point of it.
 *
 * super_admin only: this is the list of everyone who can act on the platform.
 */
export const GET = handler(async (req: Request) => {
  await requireAdmin(req, "super_admin");
  const client = createAdminClient();

  const { data, error } = await client
    .from("admins")
    .select("id, email, name, role, is_active, created_at, last_login_at")
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: String(r.id),
    email: String(r.email),
    name: String(r.name ?? ""),
    role: String(r.role),
    isActive: Boolean(r.is_active),
    createdAt: r.created_at ? String(r.created_at) : null,
    lastLoginAt: r.last_login_at ? String(r.last_login_at) : null,
  }));
});
