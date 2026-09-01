import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// List all subscriptions for the user (for billing history).
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data } = await admin.from("subscriptions").select("*").eq("user_id", user.id).order("started_at", { ascending: false });
  return (data ?? []).map((r) => ({
    id: String(r.id),
    userId: user.id,
    planId: String(r.plan_id),
    status: r.status as "active" | "cancelled" | "expired" | "past_due",
    provider: r.provider ? String(r.provider) : null,
    startedAt: String(r.started_at),
    renewsAt: r.renews_at ? String(r.renews_at) : null,
    cancelledAt: r.cancelled_at ? String(r.cancelled_at) : null,
  }));
});
