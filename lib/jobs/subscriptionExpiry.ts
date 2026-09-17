// Ending plans whose paid period is over.
//
// A card subscription tells us when it ends: Stripe sends the cancellation. A crypto
// payment does not — it bought one period, and nothing will renew it or say it stopped.
// Without this, one payment would be a plan for ever.
//
// Only subscriptions with nothing to renew them are ended here (renews_at is null and
// the period is over). Files are never touched: an account that drops to the free plan
// keeps everything, and simply cannot add more until it is under the free limit.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { defaultPlan } from "@/lib/plans/catalog";
import { audit } from "@/lib/api/audit";
import { notify } from "@/lib/notifications";

export async function runSubscriptionExpiry(): Promise<string> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: ended, error } = await admin
    .from("subscriptions")
    .select("id, user_id, plan_id")
    .eq("status", "active")
    .is("renews_at", null)
    .not("current_period_end", "is", null)
    .lt("current_period_end", now)
    .limit(200);
  if (error) return `Subscription expiry failed: ${error.message}`;

  const free = await defaultPlan();
  let expired = 0;

  for (const sub of ended ?? []) {
    const userId = String(sub.user_id);

    // Marked first: if anything below fails, the next run does not end the same
    // subscription twice and send a second notice.
    const { data: marked } = await admin
      .from("subscriptions")
      .update({ status: "expired" })
      .eq("id", sub.id)
      .eq("status", "active")
      .select("id");
    if (!marked?.length) continue;

    // Only lowered if this was the plan the account is on — a newer subscription may
    // already have replaced it.
    await admin
      .from("user_storage")
      .update({ plan_id: free.id, storage_quota_bytes: free.storageQuotaBytes })
      .eq("user_id", userId)
      .eq("plan_id", String(sub.plan_id));

    await notify({
      userId,
      type: "subscription_canceled",
      title: "Your plan's paid period has ended",
      body: "Your files are all still here. Pay again to keep the larger plan; until then uploads resume once you are under the free limit.",
      link: "/app/settings",
    });
    await audit({
      actorType: "system",
      action: "subscription.expired",
      targetType: "user",
      targetId: userId,
      metadata: { subscriptionId: String(sub.id), planId: String(sub.plan_id) },
    });
    expired += 1;
  }

  return `Subscription expiry ended ${expired} plan(s) whose paid period was over.`;
}
