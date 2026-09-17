import "server-only";
import { handler } from "@/lib/api/auth";
import { stripeProvider } from "@/lib/payments/stripe";
import { cryptoConfigured } from "@/lib/payments/crypto";

export const dynamic = "force-dynamic";

/**
 * Which ways to pay are available right now.
 *
 * Booleans and nothing else — no keys, no addresses, no configuration. The billing page
 * uses it to offer only what will work, instead of a button that answers "not enabled"
 * after someone has already chosen it. Checkout checks again regardless.
 */
export const GET = handler(async () => {
  const [stripe, crypto] = await Promise.all([
    stripeProvider.isConfigured().catch(() => false),
    cryptoConfigured().catch(() => false),
  ]);
  return { stripe, crypto };
});
