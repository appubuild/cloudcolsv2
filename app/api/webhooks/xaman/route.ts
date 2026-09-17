import "server-only";
import { cryptoProvider } from "@/lib/payments/crypto";
import { claimAndApply } from "@/lib/payments/apply";

export const dynamic = "force-dynamic";

/**
 * Where Xaman says a payload was resolved.
 *
 * The body is a hint and nothing more. Unlike Stripe's, this webhook carries no
 * signature — so instead of trusting it, the adapter reads the payload back from Xaman
 * with our own credentials and then checks the transaction on the XRP Ledger. A forged
 * request therefore buys nothing: at most it asks us to re-check a payload of ours,
 * and a payment that is not on the ledger is not a payment.
 *
 * A webhook that arrives too early — before the checkout has recorded the payment, or
 * before the ledger has validated the transaction — is acknowledged without being
 * claimed, and lib/jobs/cryptoReconcile picks the payment up on its next run. A
 * customer who paid is never left without the plan because a message came first.
 */
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  let event;
  try {
    event = await cryptoProvider.verifyWebhook(rawBody, "");
  } catch (e) {
    console.error("[xaman] could not verify", (e as Error).message);
    // 400, not 500: a body that will never verify should not be retried forever.
    return json({ error: "invalid webhook" }, 400);
  }

  try {
    const outcome = await claimAndApply(event, "crypto");
    return json({ received: true, outcome });
  } catch (e) {
    console.error("[xaman] could not record event", (e as Error).message);
    // Worth a retry: nothing was applied.
    return json({ error: "could not record event" }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
