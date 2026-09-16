// Which Developer API plan an account is on.
//
// The plan lives on the account's keys (api_keys.api_plan_id), which is where the
// enforcement reads it from — so the account's plan is simply what its keys carry, and
// changing plan means changing them together. No second copy to fall out of step.
//
// An account with no keys yet is on the free plan: the cheapest active one, from the
// api_plans table, so retiring or renaming a plan in the admin panel is respected here
// rather than contradicted by a hardcoded id.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

const FALLBACK_PLAN_ID = "api_free";

/** The cheapest active plan — what a new developer gets. */
export async function freeApiPlanId(): Promise<string> {
  const { data } = await createAdminClient()
    .from("api_plans")
    .select("id, price_cents")
    .eq("is_active", true)
    .order("price_cents", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : FALLBACK_PLAN_ID;
}

/** The plan this account's keys are on, or the free plan if it has none. */
export async function accountApiPlan(userId: string): Promise<string> {
  const { data } = await createAdminClient()
    .from("api_keys")
    .select("api_plan_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.api_plan_id ? String(data.api_plan_id) : await freeApiPlanId();
}

/** Moves every key of the account onto a plan. */
export async function setAccountApiPlan(userId: string, planId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("api_keys")
    .update({ api_plan_id: planId })
    .eq("user_id", userId);
  if (error) throw error;
}
