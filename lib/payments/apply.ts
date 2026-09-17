// What a verified payment event does to an account.
//
// One implementation for every provider. The event has already been proven genuine by
// the provider's adapter; this decides what it means — and the rule it exists to keep
// is that a quota comes from the server's own plan record, never from anything the
// event carried. A provider reports that money arrived; what it buys is ours to say.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { requirePlan, defaultPlan } from "@/lib/plans/catalog";
import { audit } from "@/lib/api/audit";
import { notify } from "@/lib/notifications";
import type { PaymentEvent } from "./types";

/**
 * When a one-off payment's period ends. Crypto does not renew itself.
 *
 * The plans table says "monthly" or "yearly". This compared against "year", which never
 * matched — so a year paid for in XRP would have bought one month.
 */
export function periodEnd(interval: string | null, from: Date = new Date()): string {
  const end = new Date(from.getTime());
  if (interval === "yearly") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end.toISOString();
}

export async function applyPaymentEvent(event: PaymentEvent): Promise<void> {
  const admin = createAdminClient();

  switch (event.kind) {
    case "payment_succeeded": {
      // Throws if the plan has gone. Better a recorded failure someone can look at
      // than granting a quota nobody can account for.
      const plan = await requirePlan(event.planId);

      const { error: quotaError } = await admin
        .from("user_storage")
        .update({ plan_id: event.planId, storage_quota_bytes: plan.storageQuotaBytes })
        .eq("user_id", event.userId);
      if (quotaError) throw quotaError;

      if (event.providerSubscriptionId) {
        // A recurring subscription: upserted on the provider's id, so a renewal
        // updates the same row rather than accumulating one per month.
        await admin.from("subscriptions").upsert(
          {
            user_id: event.userId,
            plan_id: event.planId,
            status: "active",
            provider: event.provider ?? "stripe",
            provider_subscription_id: event.providerSubscriptionId,
            provider_customer_id: event.providerCustomerId,
            current_period_end: event.currentPeriodEnd,
            started_at: new Date().toISOString(),
            renews_at: event.currentPeriodEnd,
          },
          { onConflict: "provider_subscription_id" },
        );
      } else if (event.reference) {
        /**
         * A one-off payment — crypto. There is nothing to renew, so the row this
         * activates is the pending one the checkout created, found through the payment
         * that carries our reference. renews_at stays null: nothing will renew it, and
         * the expiry job lowers the plan when the period ends.
         */
        const { data: payment } = await admin
          .from("payments")
          .select("id, subscription_id")
          .eq("provider_session_id", event.reference)
          .eq("user_id", event.userId)
          .maybeSingle();

        const ends = event.currentPeriodEnd ?? periodEnd(plan.billingInterval);
        if (payment?.subscription_id) {
          await admin
            .from("subscriptions")
            .update({
              plan_id: event.planId,
              status: "active",
              current_period_end: ends,
              renews_at: null,
              started_at: new Date().toISOString(),
            })
            .eq("id", payment.subscription_id);
        }
        if (payment?.id) {
          await admin
            .from("payments")
            .update({ status: "succeeded", provider_payment_id: event.providerPaymentId })
            .eq("id", payment.id);
        }
        await notify({
          userId: event.userId,
          type: "payment_succeeded",
          title: `Payment received — ${plan.name} is active`,
          body: `Your new storage limit applies now, until ${new Date(ends).toLocaleDateString()}.`,
          link: "/app/settings",
        });
      }

      // Recorded for every provider. Upserted on the provider's payment id so a
      // redelivery cannot book the same money twice.
      await admin.from("payments").upsert(
        {
          user_id: event.userId,
          amount_cents: event.amountCents,
          currency: event.currency,
          provider: event.provider ?? "stripe",
          status: "succeeded",
          provider_payment_id: event.providerPaymentId,
        },
        { onConflict: "provider_payment_id" },
      );

      await audit({
        actorId: event.userId,
        actorType: "system",
        action: "subscription.activated",
        targetType: "user",
        targetId: event.userId,
        metadata: {
          planId: event.planId,
          amountCents: event.amountCents,
          provider: event.provider ?? "stripe",
          ...(event.providerPaymentId ? { payment: event.providerPaymentId } : {}),
        },
      });
      return;
    }

    case "payment_failed": {
      if (event.providerPaymentId) {
        await admin.from("payments").upsert(
          {
            user_id: event.userId,
            amount_cents: 0,
            currency: "USD",
            provider: event.provider ?? "stripe",
            status: "failed",
            provider_payment_id: event.providerPaymentId,
          },
          { onConflict: "provider_payment_id" },
        );
      }
      // The plan is left alone. A provider retries a failed charge for a while, and
      // downgrading on the first failure would take storage away from someone whose
      // payment is about to succeed.
      if (event.userId) {
        await notify({
          userId: event.userId,
          type: "payment_failed",
          title: "A payment didn't go through",
          body: "Your plan is unchanged for now. Updating your payment details avoids an interruption.",
          link: "/app/settings",
        });
      }
      return;
    }

    case "subscription_cancelled": {
      const { data: subscription } = await admin
        .from("subscriptions")
        .select("user_id")
        .eq("provider_subscription_id", event.providerSubscriptionId)
        .maybeSingle();

      await admin
        .from("subscriptions")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("provider_subscription_id", event.providerSubscriptionId);

      if (subscription?.user_id) {
        // Back to whatever plan is the default. Files over that quota are not deleted —
        // that would be destroying someone's data over a billing state — but nothing
        // new fits until they are under it again.
        const free = await defaultPlan();
        await admin
          .from("user_storage")
          .update({ plan_id: free.id, storage_quota_bytes: free.storageQuotaBytes })
          .eq("user_id", subscription.user_id);

        await audit({
          actorId: String(subscription.user_id),
          actorType: "system",
          action: "subscription.cancelled",
          targetType: "user",
          targetId: String(subscription.user_id),
          metadata: { provider: event.provider ?? "stripe" },
        });

        await notify({
          userId: String(subscription.user_id),
          type: "subscription_canceled",
          title: "Your subscription has ended",
          body: "Your files are all still here. Uploads resume once you are under the free plan's limit, or when you subscribe again.",
          link: "/app/settings",
        });
      }
      return;
    }

    case "refunded": {
      await admin.from("payments").update({ status: "refunded" }).eq("provider_payment_id", event.providerPaymentId);
      return;
    }

    case "ignored":
      return;
  }
}

export type ProcessOutcome = "applied" | "duplicate" | "ignored" | "failed";

/**
 * Claims a verified event and applies it, exactly once.
 *
 * The event id is inserted first; a second delivery of the same event loses that race
 * on the primary key and stops. An "ignored" event is deliberately not claimed: for a
 * one-off payment "ignored" can mean "not yet" — the payment row did not exist when the
 * webhook arrived — and claiming it would turn a later, genuine delivery into a
 * duplicate that is thrown away. A customer would have paid and never received the plan.
 */
export async function claimAndApply(event: PaymentEvent, provider: "stripe" | "crypto"): Promise<ProcessOutcome> {
  if (event.kind === "ignored") return "ignored";

  const admin = createAdminClient();
  const { error: claimError } = await admin
    .from("payment_events")
    .insert({ id: event.eventId, provider, type: event.kind });

  if (claimError) {
    if ((claimError as { code?: string }).code === "23505") return "duplicate";
    throw claimError;
  }

  try {
    await applyPaymentEvent(event);
    await admin.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("id", event.eventId);
    return "applied";
  } catch (e) {
    const message = (e as Error).message;
    console.error(`[${provider}] handling failed`, event.kind, message);
    await admin.from("payment_events").update({ error: message }).eq("id", event.eventId);
    return "failed";
  }
}
