// The plan catalogue. The only place the server learns what a plan grants or costs.
//
// Everything that used to keep its own copy — the pricing page, checkout, the quota
// check, the Stripe webhook, new-account provisioning — reads through here, so an
// admin changing a price or a quota changes it everywhere at once, which is the
// whole point of having an admin panel.
//
// Cached for a minute per isolate. Plans change rarely and are read on nearly every
// request, and a Worker isolate is short-lived anyway; `bustPlanCache()` clears it
// in the isolate that just wrote, so an admin sees their own edit immediately.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/api/auth";
import type { Plan } from "@/lib/types";

const CACHE_TTL_MS = 60_000;

let cache: { at: number; plans: Plan[] } | null = null;

export interface PlanRow {
  id: string;
  name: string;
  tagline: string | null;
  storage_quota_bytes: number | string;
  max_file_size_bytes: number | string;
  price_cents: number;
  billing_interval: string | null;
  features: unknown;
  shows_ads: boolean;
  api_included: boolean;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
}

export function mapPlan(row: PlanRow): Plan {
  return {
    id: String(row.id),
    name: String(row.name),
    tagline: String(row.tagline ?? ""),
    // bigint arrives as a string from PostgREST once it is large enough; Number()
    // on the string is right, on a JS number it is a no-op.
    storageQuotaBytes: Number(row.storage_quota_bytes),
    maxFileSizeBytes: Number(row.max_file_size_bytes),
    priceCents: Number(row.price_cents),
    billingInterval: (row.billing_interval as Plan["billingInterval"]) ?? null,
    features: Array.isArray(row.features) ? (row.features as string[]).map(String) : [],
    showsAds: Boolean(row.shows_ads),
    apiIncluded: Boolean(row.api_included),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order),
  };
}

/** Every plan, active or not, in display order. */
export async function listPlans(): Promise<Plan[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.plans;

  const admin = createAdminClient();
  const { data, error } = await admin.from("plans").select("*").order("sort_order", { ascending: true });
  if (error) throw error;

  const plans = ((data ?? []) as unknown as PlanRow[]).map(mapPlan);
  if (plans.length === 0) {
    // No fallback to hardcoded values on purpose. A silent default is how the five
    // copies this replaced came to disagree; an empty catalogue is a deployment
    // problem and should look like one.
    throw new ApiError("PLANS_NOT_CONFIGURED", 500, "No plans are configured.");
  }

  cache = { at: Date.now(), plans };
  return plans;
}

/** Only the plans a customer may currently choose. */
export async function listActivePlans(): Promise<Plan[]> {
  return (await listPlans()).filter((p) => p.isActive);
}

/**
 * Find a plan in a list by id.
 *
 * A list scan rather than a keyed object, deliberately. The lookup this replaced
 * was `PLANS[planId]` on a plain object, where "__proto__" and "toString" both
 * resolved to something — the first to Object's prototype, which has no quota, and
 * writing that into an account's storage limit set it to undefined. An array can
 * only ever return a row that was actually in the table.
 */
export function pickPlan(plans: Plan[], id: string): Plan | null {
  return plans.find((p) => p.id === id) ?? null;
}

/** A plan by id, or null. */
export async function getPlan(id: string): Promise<Plan | null> {
  return pickPlan(await listPlans(), id);
}

/**
 * A plan by id, or a 404.
 *
 * Use this wherever an unknown id must not quietly become "free" or `undefined`.
 * A missing plan once meant writing `undefined` into an account's storage limit.
 */
export async function requirePlan(id: string): Promise<Plan> {
  const plan = await getPlan(id);
  if (!plan) throw new ApiError("PLAN_NOT_FOUND", 404, "Plan not found.");
  return plan;
}

/**
 * What a new account gets, and what an account returns to when its subscription
 * ends. Marked in the data, not assumed to be called "plan_free".
 */
export async function defaultPlan(): Promise<Plan> {
  const admin = createAdminClient();
  const { data } = await admin.from("plans").select("id").eq("is_default", true).maybeSingle();
  const id = data?.id ? String(data.id) : null;

  const plans = await listPlans();
  const plan = (id && pickPlan(plans, id)) || plans.find((p) => p.priceCents === 0);
  if (!plan) throw new ApiError("PLANS_NOT_CONFIGURED", 500, "No default plan is configured.");
  return plan;
}

/** Forget the cached catalogue. Called after an admin writes a plan. */
export function bustPlanCache(): void {
  cache = null;
}
