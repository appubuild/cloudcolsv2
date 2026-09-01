import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Current active subscription for the user.
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data } = await admin
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    userId: user.id,
    planId: String(data.plan_id),
    status: data.status as "active",
    provider: data.provider ? String(data.provider) : null,
    startedAt: String(data.started_at),
    renewsAt: data.renews_at ? String(data.renews_at) : null,
    cancelledAt: data.cancelled_at ? String(data.cancelled_at) : null,
  };
});
