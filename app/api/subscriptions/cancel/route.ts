import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

// Cancel the active subscription. We downgrade to the free plan immediately
// (quota enforced by getQuota/assertCanUpload) so storage stays within limits.
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();

  const { data: sub } = await admin
    .from("subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "active")
    .select("*")
    .maybeSingle();

  await admin.from("user_storage").update({ plan_id: "plan_free", storage_quota_bytes: 5 * 1024 * 1024 * 1024 }).eq("user_id", user.id);

  await audit({ actorId: user.id, actorType: "user", action: "subscription.cancel", targetType: "subscription", targetId: sub?.id ?? "" });

  if (!sub) throw new ApiError("NOT_FOUND", 404, "No active subscription to cancel.");
  return {
    id: String(sub.id),
    userId: user.id,
    planId: String(sub.plan_id),
    status: "cancelled" as const,
    provider: sub.provider ? String(sub.provider) : null,
    startedAt: String(sub.started_at),
    renewsAt: sub.renews_at ? String(sub.renews_at) : null,
    cancelledAt: String(sub.cancelled_at),
  };
});
