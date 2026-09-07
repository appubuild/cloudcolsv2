import "server-only";
import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";
import { listPlans } from "@/lib/plans/catalog";

export const dynamic = "force-dynamic";

/**
 * Every subscription, for the admin Subscriptions screen.
 *
 * That screen used to read the mock database in the browser, so it showed
 * fabricated subscriptions to whoever opened it while the real table went
 * unlooked-at.
 *
 * Addresses are masked for anyone below super_admin, the same rule /api/admin/users
 * applies: support can see that an account has a subscription without being handed
 * the customer's email.
 */
export const GET = handler(async (req: Request) => {
  const staff = await requireAdmin(req, "support");
  const client = createAdminClient();

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 100)));

  let query = client
    .from("subscriptions")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => String(r.user_id)))];

  let emails: Record<string, string> = {};
  if (ids.length) {
    const { data: users } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    emails = Object.fromEntries(
      (users?.users ?? []).filter((u) => ids.includes(u.id)).map((u) => [u.id, u.email ?? ""]),
    );
  }

  const planNames = new Map((await listPlans()).map((p) => [p.id, p.name]));
  const mask = (email: string) => (email ? `${email.slice(0, 2)}•••@•••` : "");

  return rows.map((r) => {
    const email = emails[String(r.user_id)] ?? "";
    return {
      id: String(r.id),
      userId: String(r.user_id),
      userEmail: staff.role === "super_admin" ? email : mask(email),
      planId: String(r.plan_id),
      planName: planNames.get(String(r.plan_id)) ?? String(r.plan_id),
      status: String(r.status),
      provider: r.provider ? String(r.provider) : null,
      startedAt: String(r.started_at),
      renewsAt: r.renews_at ? String(r.renews_at) : null,
      cancelledAt: r.cancelled_at ? String(r.cancelled_at) : null,
      currentPeriodEnd: r.current_period_end ? String(r.current_period_end) : null,
      // Whether it is attached to a real provider subscription. A row without one
      // was never something a provider is billing for.
      hasProviderSubscription: Boolean(r.provider_subscription_id),
    };
  });
});
