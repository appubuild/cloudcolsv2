import { handler } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Public plan catalog for the developer portal (read-only).
export const GET = handler(async () => {
  const admin = createAdminClient();
  const { data, error } = await admin.from("api_plans").select("*").order("price_cents", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    requestsPerMonth: Number(r.requests_per_month),
    rateLimitPerMinute: Number(r.rate_limit_per_minute),
    priceCents: Number(r.price_cents),
    isActive: Boolean(r.is_active),
  }));
});
