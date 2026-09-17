// Catching crypto payments a webhook missed.
//
// A webhook can arrive before the checkout has recorded the payment, before the ledger
// has validated the transaction, or not at all. Any of those, left alone, is a customer
// who paid and did not get what they paid for. So pending crypto payments are re-checked
// here, through exactly the verification the webhook uses — Xaman first, then the XRP
// Ledger — and granted the same way, claimed once by transaction hash so a payment the
// webhook already handled is not handled twice.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { eventForReference, cryptoConfigured } from "@/lib/payments/crypto";
import { claimAndApply } from "@/lib/payments/apply";
import { audit } from "@/lib/api/audit";

/** How far back a pending payment is still worth asking about. A quote lasts minutes. */
const LOOKBACK_HOURS = 48;
/** Payments checked per run: each is two outbound calls. */
const MAX_PER_RUN = 50;

export async function runCryptoReconcile(): Promise<string> {
  if (!(await cryptoConfigured())) return "Crypto payments are not configured; nothing to reconcile.";

  const admin = createAdminClient();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
  const { data: pending, error } = await admin
    .from("payments")
    .select("id, provider_session_id")
    .eq("provider", "crypto")
    .eq("status", "pending")
    .gte("created_at", since)
    .not("provider_session_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) return `Crypto reconcile failed: ${error.message}`;

  let applied = 0;
  let stillPending = 0;
  for (const row of pending ?? []) {
    const event = await eventForReference(String(row.provider_session_id)).catch(() => null);
    if (!event) {
      stillPending += 1;
      continue;
    }
    const outcome = await claimAndApply(event, "crypto").catch(() => "failed" as const);
    if (outcome === "applied") applied += 1;
    else stillPending += 1;
  }

  // Quotes that were never paid, older than the window: closed, so the list of pending
  // payments stays a list of payments that might still arrive.
  await admin
    .from("payments")
    .update({ status: "expired" })
    .eq("provider", "crypto")
    .eq("status", "pending")
    .lt("created_at", since);

  await audit({
    actorType: "system",
    action: "job.crypto_reconcile",
    targetType: "job",
    targetId: "crypto-reconcile",
    metadata: { checked: pending?.length ?? 0, applied, stillPending },
  });

  return `Crypto reconcile checked ${pending?.length ?? 0} pending payment(s); applied ${applied}.`;
}
