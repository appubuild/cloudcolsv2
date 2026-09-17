// Paying in XRP, through Xaman.
//
// The shape of this is set by what a blockchain payment actually is: the customer sends
// money to an address, and nothing about that is a promise to us. So the plan is granted
// only when the transaction is found on the ledger — validated, successful, to our
// address, carrying the destination tag we asked for, for at least the amount we asked
// for. Xaman tells us a payload was signed; the ledger is what decides it was paid.
//
// A destination tag is what ties an anonymous payment to an account. It is derived from
// our own reference for the attempt rather than stored, so there is no second record to
// keep in step, and it cannot be guessed into pointing at someone else's payment.
//
// One-off, not recurring: a wallet cannot be charged again without its owner signing
// again. The plan is granted for one period and lib/jobs/subscriptionExpiry lowers it
// when that period ends.

import "server-only";
import { readSettings, readSecrets } from "./settings";
import { requirePlan } from "@/lib/plans/catalog";
import { ApiError } from "@/lib/api/auth";
import type { CheckoutRequest, CheckoutResult, PaymentEvent, PaymentProvider } from "./types";

const XAMAN_API = "https://xumm.app/api/v1/platform";

/** Public XRPL JSON-RPC endpoints, when an admin has not named one. */
const DEFAULT_NODE: Record<string, string> = {
  mainnet: "https://xrplcluster.com/",
  testnet: "https://s.altnet.rippletest.net:51234/",
};

const DROPS_PER_XRP = 1_000_000;
/** How long a quoted price stands. The XRP price moves; an old quote is not a price. */
const PAYLOAD_EXPIRY_MINUTES = 20;

export interface CryptoConfig {
  destinationAddress: string;
  network: "mainnet" | "testnet";
  nodeUrl: string;
  apiKey: string;
  apiSecret: string;
}

async function config(): Promise<CryptoConfig | null> {
  const settings = await readSettings("crypto");
  if (!settings.isEnabled) return null;
  const secrets = await readSecrets("crypto");
  const destinationAddress = String(settings.publicConfig.destinationAddress ?? "").trim();
  const network = settings.publicConfig.network === "mainnet" ? "mainnet" : "testnet";
  const apiKey = String(secrets.apiKey ?? "").trim();
  const apiSecret = String(secrets.secretKey ?? secrets.apiSecret ?? "").trim();
  if (!destinationAddress || !apiKey || !apiSecret) return null;
  return {
    destinationAddress,
    network,
    nodeUrl: String(settings.publicConfig.nodeUrl ?? "").trim() || DEFAULT_NODE[network]!,
    apiKey,
    apiSecret,
  };
}

async function xaman<T>(cfg: CryptoConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${XAMAN_API}${path}`, {
    ...init,
    headers: {
      "X-API-Key": cfg.apiKey,
      "X-API-Secret": cfg.apiSecret,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = (body.error as { code?: number; reference?: string } | undefined)?.code;
    throw new ApiError("PROVIDER_ERROR", 502, `Xaman refused the request${detail ? ` (code ${detail})` : ""}.`);
  }
  return body as T;
}

/**
 * The destination tag for an attempt: a 32-bit number derived from our reference.
 *
 * Deterministic so nothing needs storing, and spread across the range so two attempts
 * do not collide in practice. Not a secret — a tag is visible on the ledger — it only
 * has to identify which payment a transfer belongs to.
 */
export function destinationTagFor(reference: string): number {
  let hash = 2166136261;
  for (let i = 0; i < reference.length; i += 1) {
    hash ^= reference.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Unsigned, and never 0 — a tag of zero reads as "no tag" to some wallets.
  return (hash >>> 0) % 4294967294 + 1;
}

/** What a price in cents costs in drops, at a quoted XRP price in USD. */
export function dropsForUsd(amountCents: number, xrpPriceUsd: number): number {
  if (!(xrpPriceUsd > 0)) throw new ApiError("PROVIDER_ERROR", 502, "No exchange rate for XRP right now.");
  const xrp = amountCents / 100 / xrpPriceUsd;
  // Rounded up: undercharging by a fraction of a drop is not worth a failed payment.
  return Math.ceil(xrp * DROPS_PER_XRP);
}

interface XrplTx {
  validated?: boolean;
  meta?: { TransactionResult?: string; delivered_amount?: unknown };
  tx_json?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PaymentCheck {
  ok: boolean;
  reason?: string;
  account?: string;
}

/**
 * Whether the ledger shows this transaction paying us what was asked.
 *
 * Every condition is checked explicitly rather than trusting a summary: a transaction
 * can exist and have failed, can be to the right address with the wrong tag (which is
 * somebody else's payment), or can be a partial payment that delivered less than its
 * stated Amount — which is exactly the trick this has to refuse.
 */
export function checkXrplPayment(
  result: XrplTx,
  expect: { destination: string; destinationTag: number; drops: number },
): PaymentCheck {
  const tx = (result.tx_json ?? result) as Record<string, unknown>;
  if (result.validated !== true) return { ok: false, reason: "not validated yet" };
  if (result.meta?.TransactionResult !== "tesSUCCESS") {
    return { ok: false, reason: `ledger says ${String(result.meta?.TransactionResult ?? "unknown")}` };
  }
  if (String(tx.TransactionType) !== "Payment") return { ok: false, reason: "not a payment" };
  if (String(tx.Destination) !== expect.destination) return { ok: false, reason: "paid to another address" };
  if (Number(tx.DestinationTag) !== expect.destinationTag) return { ok: false, reason: "destination tag does not match" };

  // delivered_amount is what actually arrived; Amount is only what was instructed, and
  // a partial payment delivers less. A non-string means it was not XRP.
  const delivered = result.meta?.delivered_amount ?? tx.Amount;
  if (typeof delivered !== "string") return { ok: false, reason: "not paid in XRP" };
  if (!/^\d+$/.test(delivered)) return { ok: false, reason: "unreadable amount" };
  if (BigInt(delivered) < BigInt(expect.drops)) return { ok: false, reason: "paid less than the amount due" };

  return { ok: true, account: tx.Account ? String(tx.Account) : undefined };
}

async function fetchTx(cfg: CryptoConfig, txid: string): Promise<XrplTx> {
  const res = await fetch(cfg.nodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "tx", params: [{ transaction: txid, binary: false }] }),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: XrplTx };
  if (!res.ok || !body.result) throw new ApiError("PROVIDER_ERROR", 502, "Could not read the transaction from the XRP Ledger.");
  return body.result;
}

interface XamanPayload {
  meta?: { signed?: boolean; cancelled?: boolean; expired?: boolean; resolved?: boolean };
  payload?: { request_json?: Record<string, unknown> };
  response?: { txid?: string; account?: string; dispatched_result?: string };
  custom_meta?: { identifier?: string; blob?: string | Record<string, unknown> };
}

export const cryptoProvider: PaymentProvider = {
  id: "crypto",

  async isConfigured() {
    return (await config()) !== null;
  },

  async startCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const cfg = await config();
    if (!cfg) throw new ApiError("PAYMENTS_NOT_CONFIGURED", 503, "Crypto payments are not configured on this deployment.");

    const plan = await requirePlan(request.planId);

    // The price in XRP, quoted now. Xaman publishes the rate it shows its own users.
    const rates = await xaman<{ XRP?: number }>(cfg, "/rates/USD", { method: "GET" });
    const drops = dropsForUsd(plan.priceCents, Number(rates.XRP ?? 0));

    // Our own reference for the attempt: it decides the destination tag, and the
    // webhook finds the pending rows by it.
    const reference = crypto.randomUUID();
    const destinationTag = destinationTagFor(reference);

    const created = await xaman<{ uuid: string; next?: { always?: string } }>(cfg, "/payload", {
      method: "POST",
      body: JSON.stringify({
        txjson: {
          TransactionType: "Payment",
          Destination: cfg.destinationAddress,
          Amount: String(drops),
          DestinationTag: destinationTag,
        },
        options: {
          expire: PAYLOAD_EXPIRY_MINUTES,
          return_url: { web: request.successUrl, app: request.successUrl },
        },
        custom_meta: {
          identifier: reference,
          blob: JSON.stringify({ userId: request.userId, planId: request.planId }),
          instruction: `CloudCols ${plan.name} — ${(drops / DROPS_PER_XRP).toFixed(6)} XRP`,
        },
      }),
    });

    const url = created.next?.always;
    if (!url) throw new ApiError("PROVIDER_ERROR", 502, "Xaman did not return a signing link.");
    return { url, reference };
  },

  /**
   * Turns a Xaman webhook into a verified event.
   *
   * The webhook body is treated as a hint and nothing more: it says which payload
   * changed, and everything that matters is then read from Xaman with our own
   * credentials and checked against the XRP Ledger. A forged webhook therefore buys an
   * attacker nothing — at most it asks us to re-check a payload that is ours anyway.
   */
  async verifyWebhook(rawBody: string): Promise<PaymentEvent> {
    const cfg = await config();
    if (!cfg) throw new ApiError("PAYMENTS_NOT_CONFIGURED", 503, "Crypto payments are not configured.");

    let hint: { payloadResponse?: { payload_uuidv4?: string }; meta?: { payload_uuidv4?: string } };
    try {
      hint = JSON.parse(rawBody);
    } catch {
      throw new ApiError("INVALID_INPUT", 400, "Unreadable webhook body.");
    }
    const uuid = hint.payloadResponse?.payload_uuidv4 ?? hint.meta?.payload_uuidv4 ?? "";
    if (!uuid) throw new ApiError("INVALID_INPUT", 400, "No payload in the webhook body.");

    const payload = await xaman<XamanPayload>(cfg, `/payload/${encodeURIComponent(uuid)}`, { method: "GET" });
    return eventFromPayload(cfg, payload, uuid);
  },

  /**
   * Nothing to stop.
   *
   * A wallet payment authorises one transfer; there is no standing instruction to
   * cancel. The plan simply ends when the period it bought ends.
   */
  async cancelSubscription() {
    return { endsAt: null };
  },
};

/**
 * The verified event a signed payload amounts to, or "ignored" if it amounts to nothing.
 *
 * Every step is checked here and nowhere else — by the webhook and by the reconciliation
 * job alike — so the two cannot come to different conclusions about the same payment.
 */
async function eventFromPayload(cfg: CryptoConfig, payload: XamanPayload, fallbackId: string): Promise<PaymentEvent> {
  const txid = payload.response?.txid;
  // Opened, declined, or expired without signing: nothing happened, and nothing is owed.
  if (!payload.meta?.signed || !txid) {
    return { kind: "ignored", eventId: `xaman:${fallbackId}`, type: "not_signed" };
  }

  const reference = String(payload.custom_meta?.identifier ?? "");
  if (!reference) return { kind: "ignored", eventId: `xaman:${txid}`, type: "no_reference" };

  const requested = payload.payload?.request_json ?? {};
  const drops = String(requested.Amount ?? "");
  if (!/^d+$/.test(drops)) return { kind: "ignored", eventId: `xaman:${txid}`, type: "not_an_xrp_payment" };

  const onLedger = await fetchTx(cfg, txid);
  const check = checkXrplPayment(onLedger, {
    destination: cfg.destinationAddress,
    destinationTag: destinationTagFor(reference),
    drops: Number(drops),
  });
  if (!check.ok) {
    // Acknowledged, never acted on: this is what an underpayment, a failed transaction,
    // a transaction not yet validated, or someone else's transfer looks like. Not
    // claimed either (see claimAndApply), so a transaction that validates later is
    // still honoured by the reconciliation job.
    console.error("[crypto] payment not honoured yet", txid, check.reason);
    return { kind: "ignored", eventId: `xaman:${txid}`, type: `unverified:${check.reason ?? "unknown"}` };
  }

  // Who and what this was for comes from our own records, keyed by the reference —
  // never from the blob, which only travels as a convenience.
  const { createAdminClient } = await import("@/lib/supabase/server");
  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("user_id, amount_cents, subscription_id")
    .eq("provider_session_id", reference)
    .eq("provider", "crypto")
    .maybeSingle();
  if (!payment) return { kind: "ignored", eventId: `xaman:${txid}`, type: "unknown_reference" };

  let planId = "";
  if (payment.subscription_id) {
    const { data: subscription } = await admin
      .from("subscriptions")
      .select("plan_id")
      .eq("id", payment.subscription_id)
      .maybeSingle();
    planId = subscription?.plan_id ? String(subscription.plan_id) : "";
  }
  if (!planId) return { kind: "ignored", eventId: `xaman:${txid}`, type: "unknown_plan" };

  return {
    kind: "payment_succeeded",
    // The transaction hash, so a redelivered webhook, the job, or both reporting the
    // same payment still process it once.
    eventId: `xaman:${txid}`,
    userId: String(payment.user_id),
    planId,
    amountCents: Number(payment.amount_cents ?? 0),
    currency: "USD",
    providerPaymentId: txid,
    providerSubscriptionId: null,
    providerCustomerId: check.account ?? payload.response?.account ?? null,
    currentPeriodEnd: null,
    provider: "crypto",
    reference,
  };
}

/**
 * The event for one of our own pending payments, looked up by our reference.
 *
 * Xaman can find a payload by the custom identifier we gave it, which is what lets the
 * reconciliation job re-check a payment without the payload id ever being stored.
 * Returns null when crypto is not configured or Xaman has no such payload.
 */
export async function eventForReference(reference: string): Promise<PaymentEvent | null> {
  const cfg = await config();
  if (!cfg) return null;
  let payload: XamanPayload;
  try {
    payload = await xaman<XamanPayload>(cfg, `/payload/ci/${encodeURIComponent(reference)}`, { method: "GET" });
  } catch {
    return null;
  }
  return eventFromPayload(cfg, payload, reference);
}

/** Whether crypto payments are switched on and fully configured. */
export async function cryptoConfigured(): Promise<boolean> {
  return (await config()) !== null;
}
