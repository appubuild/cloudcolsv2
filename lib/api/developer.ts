// Developer API helpers: authenticate an API key, enforce the plan's limits, and
// record what was used. Ownership is ALWAYS derived from the authenticated key —
// never from a client-supplied user_id.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { ApiError } from "./auth";
import { checkRateLimit } from "./rateLimit";
import { hashSecret } from "./crypto";
import { runAfterResponse } from "./background";

export interface DeveloperIdentity {
  userId: string;
  apiKeyId: string;
  planId: string;
  scopes: string[];
}

export async function authenticateApiKey(apiKey: string): Promise<DeveloperIdentity> {
  const admin = createAdminClient();
  const hashed = hashSecret(apiKey);
  const { data } = await admin
    .from("api_keys")
    .select("id, user_id, api_plan_id, scopes, status")
    .eq("hashed_key", hashed)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new ApiError("UNAUTHORIZED", 401, "Invalid API key.");
  return {
    userId: String(data.user_id),
    apiKeyId: String(data.id),
    planId: String(data.api_plan_id),
    scopes: (data.scopes as string[]) ?? [],
  };
}

/** Require a specific scope on the authenticated developer key. */
export function requireScope(identity: DeveloperIdentity, scope: string): void {
  if (!identity.scopes.includes(scope)) {
    throw new ApiError("FORBIDDEN", 403, `Missing required scope: ${scope}`);
  }
}

interface PlanLimits {
  rateLimitPerMinute: number;
  requestsPerMonth: number;
}

async function planLimits(planId: string): Promise<PlanLimits> {
  const { data } = await createAdminClient()
    .from("api_plans")
    .select("rate_limit_per_minute, requests_per_month")
    .eq("id", planId)
    .maybeSingle();
  return {
    rateLimitPerMinute: Number(data?.rate_limit_per_minute ?? 60),
    requestsPerMonth: Number(data?.requests_per_month ?? 10_000),
  };
}

function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Requests this account has made this month.
 *
 * Counted from the request log rather than the api_usage_daily rollup, because that
 * table's api_key_id still references the abandoned legacy_api_keys prototype: every
 * write for a real key violates the foreign key, so the rollup has never held a single
 * row. supabase/migrations/0028_api_usage_daily_fk.sql repoints it (and indexes the
 * column this count filters on); until that is applied, the log is the only record
 * there is — and it is the one the usage dashboard already reads.
 */
export async function usedThisMonth(userId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from("api_request_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", monthStartIso());
  return count ?? 0;
}

/**
 * The plan's limits, checked before the work is done.
 *
 * Two different things: a rate, so no single key can flood the service, and a monthly
 * allowance, which is what the plan is sold as. The rate limit is counted in a Durable
 * Object (lib/api/rateLimit.ts) so it holds across the whole service rather than per
 * isolate; the allowance is counted from the request log (see usedThisMonth).
 */
export async function enforceApiRequest(identity: DeveloperIdentity): Promise<void> {
  const limits = await planLimits(identity.planId);

  const rl = await checkRateLimit(`dev:${identity.apiKeyId}`, limits.rateLimitPerMinute, 60_000);
  if (!rl.allowed) throw new ApiError("RATE_LIMITED", 429, "Rate limit exceeded. Slow down and try again shortly.");

  if (limits.requestsPerMonth > 0 && (await usedThisMonth(identity.userId)) >= limits.requestsPerMonth) {
    throw new ApiError(
      "QUOTA_EXCEEDED",
      429,
      "This month's API request allowance is used up. It resets at the start of next month.",
    );
  }
}

/**
 * Records one request: the log line, and when the key was last used.
 *
 * After the response, not before it — the caller should not wait on our bookkeeping —
 * and never allowed to fail the request it is describing.
 */
export function recordApiRequest(
  identity: DeveloperIdentity,
  entry: { endpoint: string; method: string; status: number; ms: number },
): void {
  runAfterResponse(
    (async () => {
      const admin = createAdminClient();
      const { error } = await admin.from("api_request_logs").insert({
        api_key_id: identity.apiKeyId,
        user_id: identity.userId,
        endpoint: entry.endpoint,
        method: entry.method,
        status_code: entry.status,
        response_time_ms: Math.round(entry.ms),
      });
      // Checked, not discarded: a write that silently fails is a counter that silently
      // stops, which is how the rollup table went unnoticed for so long.
      if (error) console.error("[v1] request not logged", error.message);

      const { error: touchError } = await admin
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", identity.apiKeyId);
      if (touchError) console.error("[v1] key last_used_at not updated", touchError.message);
    })(),
    "v1 usage",
  );
}
