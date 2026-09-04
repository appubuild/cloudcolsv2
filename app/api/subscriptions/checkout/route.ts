import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";
import { serverConfig } from "@/lib/config/server-env";

export const dynamic = "force-dynamic";

const PLANS: Record<string, { quota: number; price: number }> = {
  plan_free: { quota: 5 * 1024 * 1024 * 1024, price: 0 },
  plan_plus: { quota: 100 * 1024 * 1024 * 1024, price: 499 },
  plan_pro: { quota: 200 * 1024 * 1024 * 1024, price: 899 },
  plan_business: { quota: 1024 * 1024 * 1024 * 1024, price: 1999 },
};

interface Body {
  planId: string;
  provider?: "stripe" | "crypto";
}

/**
 * Starts a plan change.
 *
 * This endpoint used to grant whatever plan it was asked for and write a payment
 * row marked "succeeded" — no provider, no charge, no verification. Any signed-in
 * account could POST plan_business and take a terabyte for nothing, and the books
 * would say it was paid for.
 *
 * A plan is worth money, so only two things may grant one: a downgrade to free,
 * which costs nothing and the account holder is entitled to; and a payment
 * provider confirming a real charge, which arrives at the webhook, not here.
 * Everything this endpoint does is create the intent to pay.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  const plan = PLANS[body.planId];
  if (!plan) throw new ApiError("PLAN_NOT_FOUND", 404, "Plan not found.");

  const admin = createAdminClient();

  // Downgrading to free is free. Nothing is charged, so nothing needs confirming.
  if (plan.price === 0) {
    await admin
      .from("user_storage")
      .update({ plan_id: body.planId, storage_quota_bytes: plan.quota })
      .eq("user_id", user.id);

    await audit({
      actorId: user.id,
      actorType: "user",
      action: "subscription.downgraded",
      targetType: "user",
      targetId: user.id,
      metadata: { planId: body.planId },
    });

    return { status: "applied" as const, planId: body.planId, checkoutUrl: null };
  }

  // A paid plan needs a provider that can actually take the money. Without one
  // configured there is nothing to redirect to, and granting the plan anyway is
  // exactly the hole this replaced.
  const provider = body.provider ?? "stripe";
  const configured =
    provider === "stripe"
      ? Boolean(serverConfig("STRIPE_SECRET_KEY"))
      : Boolean(serverConfig("CRYPTO_PAYMENTS_API_KEY"));

  if (!configured) {
    throw new ApiError(
      "PAYMENTS_NOT_CONFIGURED",
      503,
      "Payments are not enabled on this deployment yet. Nothing has been charged.",
    );
  }

  // Recorded as pending. The webhook that hears from the provider is what marks
  // it paid and raises the quota; until then the account keeps the plan it has.
  const { data: subscription, error } = await admin
    .from("subscriptions")
    .insert({
      user_id: user.id,
      plan_id: body.planId,
      status: "past_due", // not active until paid
      provider,
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;

  await admin.from("payments").insert({
    user_id: user.id,
    subscription_id: subscription?.id ?? null,
    amount_cents: plan.price,
    currency: "USD",
    provider,
    status: "pending",
  });

  await audit({
    actorId: user.id,
    actorType: "user",
    action: "subscription.checkout_started",
    targetType: "subscription",
    targetId: subscription?.id ?? "",
    metadata: { planId: body.planId, amount: plan.price, provider },
  });

  // The provider's hosted page is created by the adapter for that provider. Both
  // adapters are still to be written; the endpoint refuses above rather than
  // pretending to have redirected anywhere.
  throw new ApiError(
    "PAYMENTS_NOT_CONFIGURED",
    503,
    "This payment provider is not connected yet. Nothing has been charged.",
  );
});
