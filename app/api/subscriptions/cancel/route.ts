import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";
import { stripeProvider } from "@/lib/payments/stripe";
import { defaultPlan } from "@/lib/plans/catalog";

export const dynamic = "force-dynamic";

/**
 * Cancels the active subscription.
 *
 * This used to mark our row cancelled and immediately drop the account to the free
 * quota — while never telling Stripe anything. Both halves were wrong in the same
 * direction: the customer lost storage they had already paid for, and Stripe kept
 * charging them for it next month.
 *
 * What it does now: tell the provider to stop at the end of the paid period, and
 * leave the plan alone. The account keeps what it bought until the period ends, and
 * `customer.subscription.deleted` — which the webhook already handles — is what
 * lowers the quota.
 *
 * A subscription with no provider id never came from a provider (an older manual
 * row, or a free downgrade). There is nothing to cancel upstream, so that one is
 * closed out here.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();

  const { data: sub } = await admin
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub) throw new ApiError("NOT_FOUND", 404, "No active subscription to cancel.");

  const providerSubscriptionId = sub.provider_subscription_id ? String(sub.provider_subscription_id) : null;
  let endsAt: string | null = sub.current_period_end ? String(sub.current_period_end) : null;

  if (providerSubscriptionId && sub.provider === "stripe") {
    try {
      const result = await stripeProvider.cancelSubscription(providerSubscriptionId);
      endsAt = result.endsAt ?? endsAt;
    } catch (e) {
      // Do not mark it cancelled locally if the provider did not agree: that is how
      // an account ends up looking cancelled here and still being billed there.
      throw new ApiError(
        "PROVIDER_ERROR",
        502,
        `Could not cancel with the payment provider: ${(e as Error).message}`,
      );
    }
  }

  const { data: updated } = await admin
    .from("subscriptions")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), renews_at: null })
    .eq("id", sub.id)
    .select("*")
    .maybeSingle();

  // Only a subscription that never involved a provider is downgraded here. A paid
  // one keeps its quota until the provider says the period is over.
  if (!providerSubscriptionId) {
    const free = await defaultPlan();
    await admin
      .from("user_storage")
      .update({ plan_id: free.id, storage_quota_bytes: free.storageQuotaBytes })
      .eq("user_id", user.id);
  }

  await audit({
    actorId: user.id,
    actorType: "user",
    action: "subscription.cancel",
    targetType: "subscription",
    targetId: String(sub.id),
    metadata: { provider: sub.provider ?? null, endsAt, downgradedNow: !providerSubscriptionId },
  });

  const row = updated ?? sub;
  return {
    id: String(row.id),
    userId: user.id,
    planId: String(row.plan_id),
    status: "cancelled" as const,
    provider: row.provider ? String(row.provider) : null,
    startedAt: String(row.started_at),
    renewsAt: null,
    cancelledAt: String(row.cancelled_at ?? new Date().toISOString()),
    /** When the plan actually ends. Null means it already has. */
    accessUntil: providerSubscriptionId ? endsAt : null,
  };
});
