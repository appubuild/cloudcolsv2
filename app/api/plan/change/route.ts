import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

const PLAN_QUOTAS: Record<string, { quota: number; maxFileSize: number }> = {
  plan_free: { quota: 5 * 1024 * 1024 * 1024, maxFileSize: 1 * 1024 * 1024 * 1024 },
  plan_plus: { quota: 100 * 1024 * 1024 * 1024, maxFileSize: 2 * 1024 * 1024 * 1024 },
  plan_pro: { quota: 200 * 1024 * 1024 * 1024, maxFileSize: 3 * 1024 * 1024 * 1024 },
  plan_business: { quota: 1024 * 1024 * 1024 * 1024, maxFileSize: 5 * 1024 * 1024 * 1024 },
};

interface Body { planId: string; provider?: string }
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  const plan = PLAN_QUOTAS[body.planId];
  if (!plan) throw new ApiError("PLAN_NOT_FOUND", 404, "Plan not found.");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_storage")
    .update({ plan_id: body.planId, storage_quota_bytes: plan.quota })
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("NOT_FOUND", 404, "User profile not found.");

  // Record subscription + payment rows.
  const { data: sub } = await admin
    .from("subscriptions")
    .insert({ user_id: user.id, plan_id: body.planId, status: "active", provider: body.provider ?? "card", started_at: new Date().toISOString(), renews_at: new Date(Date.now() + 30 * 86400000).toISOString() })
    .select("*")
    .single();
  const priceCents = body.planId === "plan_free" ? 0 : (body.planId === "plan_plus" ? 499 : body.planId === "plan_pro" ? 899 : 1999);
  if (sub) {
    await admin.from("payments").insert({ user_id: user.id, subscription_id: sub.id, amount_cents: priceCents, currency: "USD", provider: body.provider ?? "card", status: priceCents === 0 ? "succeeded" : "succeeded" });
  }

  await audit({ actorId: user.id, actorType: "user", action: "subscription.change_plan", targetType: "subscription", targetId: sub?.id ?? "", metadata: { planId: body.planId } });
  return {
    planId: data.plan_id,
    storageQuotaBytes: Number(data.storage_quota_bytes),
    storageUsedBytes: Number(data.storage_used_bytes),
  };
});
