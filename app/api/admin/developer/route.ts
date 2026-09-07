import "server-only";
import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The Developer API, across all accounts, for the admin Developer screen.
 *
 * That screen read the browser's mock database: it listed invented API keys,
 * invented request logs and invented webhooks, on a page whose entire job is to
 * tell an operator what is really happening.
 *
 * Nothing secret crosses this boundary. An API key is stored as a hash and shown
 * once at creation; what is returned here is the display prefix, which is what the
 * developer's own portal shows too. Webhook signing secrets are omitted entirely —
 * the developer needs theirs, an operator does not.
 */
export const GET = handler(async (req: Request) => {
  const staff = await requireAdmin(req, "support");
  const client = createAdminClient();

  const [plansRes, keysRes, logsRes, hooksRes] = await Promise.all([
    client.from("api_plans").select("*").order("price_cents", { ascending: true }),
    client
      .from("api_keys")
      .select("id, user_id, api_plan_id, key_prefix, label, scopes, status, created_at, last_used_at")
      .order("created_at", { ascending: false })
      .limit(200),
    client
      .from("api_request_logs")
      .select("id, user_id, endpoint, method, status_code, response_time_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    client
      .from("webhooks")
      .select("id, user_id, url, events, status, created_at, last_delivery_status, last_delivered_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  for (const res of [plansRes, keysRes, logsRes, hooksRes]) {
    if (res.error) throw res.error;
  }

  const ids = [
    ...new Set([
      ...(keysRes.data ?? []).map((r) => String(r.user_id)),
      ...(hooksRes.data ?? []).map((r) => String(r.user_id)),
      ...(logsRes.data ?? []).map((r) => String(r.user_id)),
    ]),
  ];

  let emails: Record<string, string> = {};
  if (ids.length) {
    const { data: users } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    emails = Object.fromEntries(
      (users?.users ?? []).filter((u) => ids.includes(u.id)).map((u) => [u.id, u.email ?? ""]),
    );
  }
  const who = (userId: string) => {
    const email = emails[userId] ?? "";
    if (!email) return userId.slice(0, 8);
    return staff.role === "super_admin" ? email : `${email.slice(0, 2)}•••@•••`;
  };

  return {
    plans: (plansRes.data ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      requestsPerMonth: Number(r.requests_per_month),
      rateLimitPerMinute: Number(r.rate_limit_per_minute),
      priceCents: Number(r.price_cents),
      isActive: Boolean(r.is_active),
    })),
    keys: (keysRes.data ?? []).map((r) => ({
      id: String(r.id),
      owner: who(String(r.user_id)),
      apiPlanId: String(r.api_plan_id ?? ""),
      keyPrefix: String(r.key_prefix),
      label: String(r.label),
      scopes: (r.scopes as string[]) ?? [],
      status: String(r.status),
      createdAt: String(r.created_at),
      lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
    })),
    logs: (logsRes.data ?? []).map((r) => ({
      id: String(r.id),
      owner: who(String(r.user_id)),
      endpoint: String(r.endpoint),
      method: String(r.method),
      statusCode: Number(r.status_code),
      responseTimeMs: Number(r.response_time_ms ?? 0),
      createdAt: String(r.created_at),
    })),
    webhooks: (hooksRes.data ?? []).map((r) => ({
      id: String(r.id),
      owner: who(String(r.user_id)),
      url: String(r.url),
      events: (r.events as string[]) ?? [],
      status: String(r.status),
      createdAt: String(r.created_at),
      lastDeliveryStatus: r.last_delivery_status ? String(r.last_delivery_status) : null,
      lastDeliveredAt: r.last_delivered_at ? String(r.last_delivered_at) : null,
    })),
  };
});
