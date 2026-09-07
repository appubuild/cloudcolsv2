import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";
import { stripeProvider } from "@/lib/payments/stripe";
import { requirePlan } from "@/lib/plans/catalog";
import { serverConfig } from "@/lib/config/server-env";

export const dynamic = "force-dynamic";

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
  // From the plans table, so what a plan costs and grants is whatever the admin
  // panel last said it was. requirePlan throws PLAN_NOT_FOUND for an id that is
  // not there, which is also the check that keeps a caller from naming its own.
  const plan = await requirePlan(body.planId);
  if (!plan.isActive) throw new ApiError("PLAN_UNAVAILABLE", 409, "That plan is not available.");

  const admin = createAdminClient();

  // Downgrading to free is free. Nothing is charged, so nothing needs confirming.
  if (plan.priceCents === 0) {
    await admin
      .from("user_storage")
      .update({ plan_id: plan.id, storage_quota_bytes: plan.storageQuotaBytes })
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
  if (provider !== "stripe") {
    // Crypto has an adapter slot and no adapter. Saying so is better than a
    // generic failure the user cannot act on.
    throw new ApiError("PROVIDER_UNAVAILABLE", 503, "Crypto payments are not available yet.");
  }

  if (!(await stripeProvider.isConfigured())) {
    throw new ApiError(
      "PAYMENTS_NOT_CONFIGURED",
      503,
      "Payments are not enabled on this deployment yet. Nothing has been charged.",
    );
  }

  // Stripe needs somewhere to send the customer back to. From the Worker's own
  // bindings, so it follows the deployment rather than a build-time guess.
  const appUrl = (serverConfig("NEXT_PUBLIC_APP_URL", "APP_URL") || "https://cloudcols.com").replace(/\/+$/, "");
  const checkout = await stripeProvider.startCheckout({
    userId: user.id,
    userEmail: user.email,
    planId: body.planId,
    successUrl: `${appUrl}/app/storage?checkout=success`,
    cancelUrl: `${appUrl}/pricing?checkout=cancelled`,
  });

  // Recorded as pending. The webhook that hears from Stripe is what marks it paid
  // and raises the quota; until then the account keeps the plan it has.
  const { data: subscription } = await admin
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

  await admin.from("payments").insert({
    user_id: user.id,
    subscription_id: subscription?.id ?? null,
    amount_cents: plan.priceCents,
    currency: "USD",
    provider,
    status: "pending",
    provider_session_id: checkout.reference,
  });

  await audit({
    actorId: user.id,
    actorType: "user",
    action: "subscription.checkout_started",
    targetType: "subscription",
    targetId: subscription?.id ?? "",
    metadata: { planId: plan.id, amount: plan.priceCents, provider, session: checkout.reference },
  });

  return { status: "checkout" as const, planId: body.planId, checkoutUrl: checkout.url };
});
