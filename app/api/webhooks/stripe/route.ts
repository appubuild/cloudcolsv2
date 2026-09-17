import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { stripeProvider } from "@/lib/payments/stripe";
import { applyPaymentEvent } from "@/lib/payments/apply";

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
 *
 * What a verified event does lives in lib/payments/apply.ts, shared with the crypto
 * webhook, so the two providers cannot grant plans by different rules.
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
    await applyPaymentEvent(event);
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

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
