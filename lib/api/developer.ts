// Developer API helpers: authenticate an API key, enforce rate limits by plan,
// and log usage. The public `/v1` API will use these. Ownership is ALWAYS
// derived from the authenticated key — never from a client-supplied user_id.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { ApiError } from "./auth";
import { checkRateLimit } from "./rateLimit";
import { hashSecret } from "./crypto";

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

/** Enforce the plan's per-minute rate limit + record a request log. */
export async function enforceAndLogRequest(
  identity: DeveloperIdentity,
  endpoint: string,
  method: string
): Promise<void> {
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("api_plans")
    .select("rate_limit_per_minute")
    .eq("id", identity.planId)
    .maybeSingle();
  const limit = Number(plan?.rate_limit_per_minute ?? 60);

  const rl = checkRateLimit(`dev:${identity.apiKeyId}`, limit, 60_000);
  if (!rl.allowed) throw new ApiError("RATE_LIMITED", 429, "Rate limit exceeded.");

  // Record usage (fire-and-forget).
  try {
    await admin.from("api_request_logs").insert({ api_key_id: identity.apiKeyId, user_id: identity.userId, endpoint, method, status_code: 200 });
  } catch {
    /* usage logging must never break the request */
  }
}
