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

/**
 * A plan id.
 *
 * A plain string now, not a union. Plans are rows in the `plans` table that an
 * admin creates and retires, so the set is not knowable at compile time — a union
 * would have to be edited and redeployed every time someone adds a plan, which is
 * the opposite of what the admin panel is for.
 *
 * What the union was really buying was "this id is real", and a type could only
 * ever claim that. `requirePlan()` in lib/plans/catalog checks it against the
 * table, which is the only place the answer actually lives.
 */
export type PlanId = string;

/** Who took the money. */
export type ProviderName = "stripe" | "crypto";

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
      /** Which provider it came from. Absent means Stripe, which predates the second one. */
      provider?: ProviderName;
      /**
       * Our own id for the attempt, for a payment that is not a subscription.
       *
       * A one-off payment — crypto — has no recurring id to key on, so this is how the
       * event finds the pending rows the checkout created. Recorded as
       * payments.provider_session_id.
       */
      reference?: string | null;
    }
  | {
      kind: "payment_failed";
      eventId: string;
      userId: string | null;
      providerPaymentId: string | null;
      provider?: ProviderName;
    }
  | { kind: "subscription_cancelled"; eventId: string; providerSubscriptionId: string; provider?: ProviderName }
  | { kind: "refunded"; eventId: string; providerPaymentId: string; provider?: ProviderName }
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

  /**
   * Stops the recurring charge, at the end of the period already paid for.
   *
   * Not immediately: the customer paid through to a date, and taking the storage
   * away before it is a refund we did not give. The plan is lowered when the
   * provider says the subscription actually ended, which arrives at the webhook
   * as `subscription_cancelled`.
   */
  cancelSubscription(providerSubscriptionId: string): Promise<{ endsAt: string | null }>;
}

/**
 * What each plan costs and grants used to be a constant here.
 *
 * It is now the `plans` table, read through `lib/plans/catalog`. The rule it
 * encoded has not changed and still matters: a quota comes from the server's own
 * record of the plan, never from anything the request or the provider's event
 * carried. Stripe reports that money arrived; what it buys is ours to decide.
 */
