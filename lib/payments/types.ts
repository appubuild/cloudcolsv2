import "server-only";

/**
 * What a payment provider has to be able to do.
 *
 * Deliberately small. Everything CloudCols knows about money goes through these
 * four operations, so adding Xaman or an XRPL adapter later means writing one
 * file — not touching the plan logic, the quota logic, or Stripe.
 *
 * Two rules the interface encodes rather than leaves to convention:
 *
 *   - `startCheckout` never grants anything. It returns somewhere to pay. A plan
 *     is only ever granted by a verified webhook, because a client can call any
 *     endpoint it likes and say the payment went through.
 *   - `verifyWebhook` returns the parsed event or throws. It does not return a
 *     boolean that a caller might forget to check.
 */

export type PlanId = "plan_free" | "plan_plus" | "plan_pro" | "plan_business";

export interface CheckoutRequest {
  userId: string;
  userEmail: string;
  planId: PlanId;
  /** Where the provider sends the customer afterwards. */
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  /** The provider's hosted page. The browser is sent here. */
  url: string;
  /** The provider's id for this attempt, recorded so the webhook can be matched to it. */
  reference: string;
}

/** What a verified webhook told us. Only these outcomes change an account. */
export type PaymentEvent =
  | {
      kind: "payment_succeeded";
      /** The provider's id for the event, used to make processing idempotent. */
      eventId: string;
      userId: string;
      planId: PlanId;
      amountCents: number;
      currency: string;
      providerPaymentId: string;
      providerSubscriptionId: string | null;
      providerCustomerId: string | null;
      currentPeriodEnd: string | null;
    }
  | { kind: "payment_failed"; eventId: string; userId: string | null; providerPaymentId: string | null }
  | { kind: "subscription_cancelled"; eventId: string; providerSubscriptionId: string }
  | { kind: "refunded"; eventId: string; providerPaymentId: string }
  /** Something we do not act on. Recorded, acknowledged, ignored. */
  | { kind: "ignored"; eventId: string; type: string };

export interface PaymentProvider {
  readonly id: "stripe" | "crypto";

  /** Whether an admin has configured and enabled it. */
  isConfigured(): Promise<boolean>;

  startCheckout(request: CheckoutRequest): Promise<CheckoutResult>;

  /**
   * Verifies the signature and parses the event, or throws.
   *
   * Takes the raw body, not a parsed object: signatures are over the exact bytes
   * the provider sent, and re-serialising JSON changes them.
   */
  verifyWebhook(rawBody: string, signature: string): Promise<PaymentEvent>;
}

/** What each plan costs and grants. The server's copy is the one that counts. */
export const PLANS: Record<PlanId, { quota: number; priceCents: number; name: string }> = {
  plan_free: { quota: 5 * 1024 * 1024 * 1024, priceCents: 0, name: "Free" },
  plan_plus: { quota: 100 * 1024 * 1024 * 1024, priceCents: 499, name: "Plus" },
  plan_pro: { quota: 200 * 1024 * 1024 * 1024, priceCents: 899, name: "Pro" },
  plan_business: { quota: 1024 * 1024 * 1024 * 1024, priceCents: 1999, name: "Business" },
};

export function isPlanId(value: string): value is PlanId {
  // hasOwnProperty, not `in`: `in` walks the prototype chain, so "__proto__" and
  // "toString" both answered true. PLANS["__proto__"] is the Object prototype,
  // which has no quota — the plan update would then have written undefined into
  // the account's storage limit.
  return Object.prototype.hasOwnProperty.call(PLANS, value);
}
