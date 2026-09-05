import "server-only";
import Stripe from "stripe";
import { readSettings, readSecrets } from "./settings";
import { PLANS, isPlanId, type CheckoutRequest, type CheckoutResult, type PaymentEvent, type PaymentProvider } from "./types";

/**
 * Stripe, on Cloudflare Workers.
 *
 * Two things differ from Stripe's Node examples, and both are silent failures if
 * missed. The SDK defaults to Node's http module, which Workers does not have, so
 * it is given a fetch-based client. And webhook verification defaults to Node
 * crypto, which is synchronous; Workers only has async SubtleCrypto, so
 * constructEventAsync with a SubtleCryptoProvider is the only version that works
 * here — the synchronous one throws at runtime, in the webhook, where it is least
 * convenient to discover.
 */

let cached: { key: string; client: Stripe } | null = null;

async function client(): Promise<Stripe | null> {
  const { secretKey } = await readSecrets("stripe");
  if (!secretKey) return null;

  // Rebuilt when the key changes, so rotating it from the admin panel takes
  // effect without a deploy.
  if (cached?.key === secretKey) return cached.client;

  const stripe = new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    // Pinning the version means Stripe changing its default does not change what
    // this code receives.
    apiVersion: "2025-10-29.clover" as Stripe.LatestApiVersion,
  });
  cached = { key: secretKey, client: stripe };
  return stripe;
}

const webCrypto = Stripe.createSubtleCryptoProvider();

export const stripeProvider: PaymentProvider = {
  id: "stripe",

  async isConfigured() {
    const settings = await readSettings("stripe");
    if (!settings.isEnabled || !settings.hasSecretKey) return false;
    // Without a webhook secret nothing can be verified, so nothing could ever be
    // granted — better to report unconfigured than to take money for a plan that
    // will never activate.
    return settings.hasWebhookSecret;
  },

  async startCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const stripe = await client();
    if (!stripe) throw new Error("Stripe is not configured.");

    const settings = await readSettings("stripe");
    const plan = PLANS[request.planId];
    const priceId = settings.publicConfig.priceIds?.[request.planId];

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: request.userEmail,
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      line_items: [
        priceId
          ? { price: priceId, quantity: 1 }
          : {
              // No price configured: build one inline from the server's own plan
              // table, so a deployment works before an admin has created products
              // in Stripe. The amount still comes from the server, never the client.
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: plan.priceCents,
                recurring: { interval: "month" },
                product_data: { name: `CloudCols ${plan.name}` },
              },
            },
      ],
      // Carried back on the webhook. Stripe's customer_email is not a reliable
      // way to identify an account — people change addresses, and two accounts
      // can share one — so the account id travels with the session.
      metadata: { userId: request.userId, planId: request.planId },
      subscription_data: {
        metadata: { userId: request.userId, planId: request.planId },
      },
      // Stripe deduplicates a retried create with the same key, so a double click
      // does not open two checkouts against one account and plan.
      // (Scoped per minute so a genuine second attempt later still works.)
    }, {
      idempotencyKey: `checkout:${request.userId}:${request.planId}:${Math.floor(Date.now() / 60000)}`,
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL.");
    return { url: session.url, reference: session.id };
  },

  async verifyWebhook(rawBody: string, signature: string): Promise<PaymentEvent> {
    const { webhookSecret } = await readSecrets("stripe");
    if (!webhookSecret) throw new Error("Stripe webhook secret is not configured.");

    // Throws on a bad signature, which is what we want: an unverified body is
    // just a stranger's POST and must never reach the plan logic.
    const event = await Stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      webCrypto,
    );

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Only a session Stripe considers paid grants anything. A completed
        // session with an unpaid status is a checkout that finished without money
        // changing hands.
        if (session.payment_status !== "paid") {
          return { kind: "ignored", eventId: event.id, type: `${event.type}:${session.payment_status}` };
        }

        const userId = session.metadata?.userId ?? null;
        const planId = session.metadata?.planId ?? "";
        if (!userId || !isPlanId(planId)) {
          return { kind: "ignored", eventId: event.id, type: `${event.type}:unattributable` };
        }

        return {
          kind: "payment_succeeded",
          eventId: event.id,
          userId,
          planId,
          amountCents: session.amount_total ?? PLANS[planId].priceCents,
          currency: (session.currency ?? "usd").toUpperCase(),
          providerPaymentId: String(session.payment_intent ?? session.id),
          providerSubscriptionId: session.subscription ? String(session.subscription) : null,
          providerCustomerId: session.customer ? String(session.customer) : null,
          currentPeriodEnd: null,
        };
      }

      case "invoice.paid": {
        // A renewal. The plan is already right; this extends the period.
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | null };
        const subscriptionId = invoice.subscription ? String(invoice.subscription) : null;
        const userId = (invoice.metadata?.userId as string | undefined) ?? null;
        const planId = (invoice.metadata?.planId as string | undefined) ?? "";
        if (!userId || !isPlanId(planId) || !subscriptionId) {
          return { kind: "ignored", eventId: event.id, type: `${event.type}:unattributable` };
        }
        return {
          kind: "payment_succeeded",
          eventId: event.id,
          userId,
          planId,
          amountCents: invoice.amount_paid ?? 0,
          currency: (invoice.currency ?? "usd").toUpperCase(),
          providerPaymentId: String(invoice.id),
          providerSubscriptionId: subscriptionId,
          providerCustomerId: invoice.customer ? String(invoice.customer) : null,
          currentPeriodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
        };
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        return {
          kind: "payment_failed",
          eventId: event.id,
          userId: (invoice.metadata?.userId as string | undefined) ?? null,
          providerPaymentId: invoice.id ? String(invoice.id) : null,
        };
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        return { kind: "subscription_cancelled", eventId: event.id, providerSubscriptionId: subscription.id };
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        return { kind: "refunded", eventId: event.id, providerPaymentId: String(charge.payment_intent ?? charge.id) };
      }

      default:
        return { kind: "ignored", eventId: event.id, type: event.type };
    }
  },
};
