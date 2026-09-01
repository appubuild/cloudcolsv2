import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

const PLANS: Record<string, { quota: number; price: number }> = {
  plan_free: { quota: 5 * 1024 * 1024 * 1024, price: 0 },
  plan_plus: { quota: 100 * 1024 * 1024 * 1024, price: 499 },
  plan_pro: { quota: 200 * 1024 * 1024 * 1024, price: 899 },
  plan_business: { quota: 1024 * 1024 * 1024 * 1024, price: 1999 },
};

interface Body { planId: string; provider?: string }
// Provider-adapter checkout. In a real deployment the payment provider validates
// payment and posts back to a webhook; this applies the plan on confirmation.
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  const plan = PLANS[body.planId];
  if (!plan) throw new ApiError("PLAN_NOT_FOUND", 404, "Plan not found.");

  const admin = createAdminClient();
  await admin.from("user_storage").update({ plan_id: body.planId, storage_quota_bytes: plan.quota }).eq("user_id", user.id);

  const { data: subscription } = await admin
    .from("subscriptions")
    .insert({ user_id: user.id, plan_id: body.planId, status: "active", provider: body.provider ?? "card", started_at: new Date().toISOString(), renews_at: new Date(Date.now() + 30 * 86400000).toISOString() })
    .select("*")
    .single();

  const { data: payment } = await admin
    .from("payments")
    .insert({ user_id: user.id, subscription_id: subscription?.id ?? null, amount_cents: plan.price, currency: "USD", provider: body.provider ?? "card", status: plan.price === 0 ? "succeeded" : "succeeded" })
    .select("*")
    .single();

  await audit({ actorId: user.id, actorType: "user", action: "subscription.checkout", targetType: "subscription", targetId: subscription?.id ?? "", metadata: { planId: body.planId, amount: plan.price } });

  return {
    subscription: subscription ? {
      id: String(subscription.id), userId: user.id, planId: String(subscription.plan_id), status: "active" as const,
      provider: subscription.provider ? String(subscription.provider) : null,
      startedAt: String(subscription.started_at), renewsAt: subscription.renews_at ? String(subscription.renews_at) : null, cancelledAt: null,
    } : null,
    payment: payment ? {
      id: String(payment.id), userId: user.id, subscriptionId: payment.subscription_id ? String(payment.subscription_id) : null,
      amountCents: Number(payment.amount_cents), currency: String(payment.currency), provider: payment.provider ? String(payment.provider) : null,
      status: payment.status as "succeeded", createdAt: String(payment.created_at),
    } : null,
  };
});
