import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { stripeProvider } from "@/lib/payments/stripe";
import { PLANS } from "@/lib/payments/types";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

/**
 * Where a plan is actually granted.
 *
 * Not the checkout endpoint, which any signed-in client can call and which knows
 * only what it was told. This route is the one place that raises a quota, and it
 * only does so for a body Stripe signed.
 *
 * Three things this has to get right, all of which are quiet failures:
 *
 *   - The signature is over the exact bytes Stripe sent. Reading req.json() and
 *     re-serialising changes them, and verification fails for a body that was
 *     genuinely fine.
 *   - Stripe delivers at least once and documents that it retries. A repeated
 *     "payment succeeded" processed twice grants the plan twice and doubles the
 *     books, so the event id is recorded first and a duplicate is a no-op.
 *   - An unverified body is a stranger's POST. It never reaches the plan logic.
 */
export async function POST(req: Request): Promise<Response> {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "missing signature" }, 400);

  // The raw text, deliberately. See above.
  const rawBody = await req.text();

  let event;
  try {
    event = await stripeProvider.verifyWebhook(rawBody, signature);
  } catch (e) {
    // 400, not 500: Stripe retries a 5xx, and a body that will never verify
    // should not be retried forever.
    console.error("[stripe] signature verification failed", (e as Error).message);
    return json({ error: "invalid signature" }, 400);
  }

  const admin = createAdminClient();

  // Claim the event before doing anything with it. The primary key is the
  // provider's event id, so a redelivery loses the race and stops here.
  const { error: claimError } = await admin
    .from("payment_events")
    .insert({ id: event.eventId, provider: "stripe", type: event.kind });

  if (claimError) {
    // 23505 is a unique violation: already handled. Acknowledged so Stripe stops
    // retrying, because it was processed the first time.
    if ((claimError as { code?: string }).code === "23505") {
      return json({ received: true, duplicate: true });
    }
    console.error("[stripe] could not record event", claimError.message);
    // A 500 here is right: Stripe retries, and we would rather handle it late
    // than lose it.
    return json({ error: "could not record event" }, 500);
  }

  try {
    await applyEvent(event);
    await admin.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("id", event.eventId);
    return json({ received: true });
  } catch (e) {
    const message = (e as Error).message;
    console.error("[stripe] handling failed", event.kind, message);
    await admin.from("payment_events").update({ error: message }).eq("id", event.eventId);
    // Left unprocessed with the error recorded. Returning 500 asks Stripe to
    // retry, but the row already exists, so the retry would be treated as a
    // duplicate — acknowledge instead and leave the row for someone to look at.
    return json({ received: true, handled: false });
  }
}

async function applyEvent(event: Awaited<ReturnType<typeof stripeProvider.verifyWebhook>>): Promise<void> {
  const admin = createAdminClient();

  switch (event.kind) {
    case "payment_succeeded": {
      const plan = PLANS[event.planId];

      // The quota comes from the server's plan table, never from the event. What
      // Stripe reports is that money arrived, not what it buys.
      const { error: quotaError } = await admin
        .from("user_storage")
        .update({ plan_id: event.planId, storage_quota_bytes: plan.quota })
        .eq("user_id", event.userId);
      if (quotaError) throw quotaError;

      // Upserted on the provider's subscription id, so a renewal updates the same
      // row rather than accumulating one per month.
      if (event.providerSubscriptionId) {
        await admin.from("subscriptions").upsert(
          {
            user_id: event.userId,
            plan_id: event.planId,
            status: "active",
            provider: "stripe",
            provider_subscription_id: event.providerSubscriptionId,
            provider_customer_id: event.providerCustomerId,
            current_period_end: event.currentPeriodEnd,
            started_at: new Date().toISOString(),
            renews_at: event.currentPeriodEnd,
          },
          { onConflict: "provider_subscription_id" },
        );
      }

      await admin.from("payments").upsert(
        {
          user_id: event.userId,
          amount_cents: event.amountCents,
          currency: event.currency,
          provider: "stripe",
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
        metadata: { planId: event.planId, amountCents: event.amountCents, provider: "stripe" },
      });
      return;
    }

    case "payment_failed": {
      if (event.providerPaymentId) {
        await admin
          .from("payments")
          .upsert(
            {
              user_id: event.userId,
              amount_cents: 0,
              currency: "USD",
              provider: "stripe",
              status: "failed",
              provider_payment_id: event.providerPaymentId,
            },
            { onConflict: "provider_payment_id" },
          );
      }
      // The plan is left alone. Stripe retries a failed invoice for a while, and
      // downgrading on the first failure would take storage away from someone
      // whose card is about to succeed.
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
        // Back to free. Files over the free quota are not deleted — that would be
        // destroying someone's data over a billing state — but nothing new fits
        // until they are under it again.
        await admin
          .from("user_storage")
          .update({ plan_id: "plan_free", storage_quota_bytes: PLANS.plan_free.quota })
          .eq("user_id", subscription.user_id);

        await audit({
          actorId: String(subscription.user_id),
          actorType: "system",
          action: "subscription.cancelled",
          targetType: "user",
          targetId: String(subscription.user_id),
          metadata: { provider: "stripe" },
        });
      }
      return;
    }

    case "refunded": {
      await admin
        .from("payments")
        .update({ status: "refunded" })
        .eq("provider_payment_id", event.providerPaymentId);
      return;
    }

    case "ignored":
      return;
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
