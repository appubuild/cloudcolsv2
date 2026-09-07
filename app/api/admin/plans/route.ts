import "server-only";
import { handler, ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";
import { listPlans, bustPlanCache, mapPlan, type PlanRow } from "@/lib/plans/catalog";

export const dynamic = "force-dynamic";

/**
 * Reading and writing the plan catalogue.
 *
 * The admin Plans screen used to edit a copy of the plans held in the browser's
 * own storage and show "Plan updated". Nothing left the page. The prices the
 * product actually charged were four hardcoded copies in the server, and no
 * screen could reach any of them.
 *
 * Every plan, including retired ones — an admin needs to see what they turned off
 * in order to turn it back on.
 */
export const GET = handler(async (req: Request) => {
  await requireAdmin(req, "support");
  return listPlans();
});

interface Body {
  id?: string;
  name?: string;
  tagline?: string;
  storageQuotaBytes?: number;
  maxFileSizeBytes?: number;
  priceCents?: number;
  billingInterval?: "monthly" | "yearly" | null;
  features?: string[];
  showsAds?: boolean;
  apiIncluded?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

const GIB = 1024 * 1024 * 1024;

/**
 * Update a plan.
 *
 * Billing, so super_admin: this decides what customers are charged and how much
 * storage the business gives away.
 *
 * The id is never editable. Accounts, subscriptions and Stripe session metadata
 * all carry it, and renaming it would orphan every one of them.
 */
export const PATCH = handler(async (req: Request) => {
  const staff = await requireAdmin(req, "super_admin");
  const body = (await req.json()) as Body;

  const id = String(body.id ?? "").trim();
  if (!id) throw new ApiError("INVALID_INPUT", 400, "A plan id is required.");

  const admin = createAdminClient();
  const { data: existing } = await admin.from("plans").select("*").eq("id", id).maybeSingle();
  if (!existing) throw new ApiError("PLAN_NOT_FOUND", 404, "Plan not found.");

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 60) throw new ApiError("INVALID_INPUT", 400, "Name must be 1–60 characters.");
    updates.name = name;
  }
  if (body.tagline !== undefined) updates.tagline = String(body.tagline).slice(0, 120);

  if (body.storageQuotaBytes !== undefined) {
    const quota = Number(body.storageQuotaBytes);
    if (!Number.isFinite(quota) || quota <= 0) {
      throw new ApiError("INVALID_INPUT", 400, "Storage quota must be a positive number of bytes.");
    }
    updates.storage_quota_bytes = Math.round(quota);
  }

  if (body.maxFileSizeBytes !== undefined) {
    const max = Number(body.maxFileSizeBytes);
    if (!Number.isFinite(max) || max <= 0) {
      throw new ApiError("INVALID_INPUT", 400, "Max file size must be a positive number of bytes.");
    }
    updates.max_file_size_bytes = Math.round(max);
  }

  if (body.priceCents !== undefined) {
    const price = Number(body.priceCents);
    if (!Number.isInteger(price) || price < 0) {
      throw new ApiError("INVALID_INPUT", 400, "Price must be a whole number of cents, zero or more.");
    }
    updates.price_cents = price;
  }

  if (body.billingInterval !== undefined) {
    if (body.billingInterval !== null && !["monthly", "yearly"].includes(body.billingInterval)) {
      throw new ApiError("INVALID_INPUT", 400, "Billing interval must be monthly, yearly, or none.");
    }
    updates.billing_interval = body.billingInterval;
  }

  if (body.features !== undefined) {
    if (!Array.isArray(body.features)) throw new ApiError("INVALID_INPUT", 400, "Features must be a list.");
    updates.features = body.features.map((f) => String(f).slice(0, 120)).slice(0, 12);
  }

  if (body.showsAds !== undefined) updates.shows_ads = Boolean(body.showsAds);
  if (body.apiIncluded !== undefined) updates.api_included = Boolean(body.apiIncluded);
  if (body.sortOrder !== undefined) updates.sort_order = Math.round(Number(body.sortOrder) || 0);

  if (body.isActive !== undefined) {
    const isActive = Boolean(body.isActive);
    // Retiring the plan new accounts are given would leave signup with nothing to
    // hand out. Move the default first, then retire this one.
    if (!isActive && existing.is_default) {
      throw new ApiError(
        "PLAN_IN_USE",
        409,
        "This is the default plan for new accounts. Make another plan the default before retiring it.",
      );
    }
    updates.is_active = isActive;
  }

  if (Object.keys(updates).length === 0) return mapPlan(existing as unknown as PlanRow);

  // A price without an interval cannot be billed, and an interval without a price
  // charges nothing on a schedule. The database has a constraint for this; check it
  // here too so the admin gets a sentence rather than a Postgres error.
  const finalPrice = updates.price_cents !== undefined ? Number(updates.price_cents) : Number(existing.price_cents);
  const finalInterval =
    updates.billing_interval !== undefined ? updates.billing_interval : existing.billing_interval;
  if (finalPrice > 0 && !finalInterval) {
    throw new ApiError("INVALID_INPUT", 400, "A paid plan needs a billing interval.");
  }
  if (finalPrice === 0 && finalInterval) {
    throw new ApiError("INVALID_INPUT", 400, "A free plan cannot have a billing interval.");
  }

  const { data: updated, error } = await admin.from("plans").update(updates).eq("id", id).select("*").single();
  if (error) throw new ApiError("UPDATE_FAILED", 400, error.message);

  bustPlanCache();

  // A quota lives in two places: the plan, and a copy on each account (so an
  // account can be given more than its plan without inventing a plan for it).
  // Raising the plan therefore has to reach the accounts, or "Pro is now 500 GB"
  // would be true on the pricing page and false for every existing Pro customer.
  //
  // Only accounts still on the old standard allowance are moved. One that was
  // adjusted by hand has a different number, and that was somebody's decision.
  let accountsUpdated = 0;
  if (updates.storage_quota_bytes !== undefined) {
    const previous = Number(existing.storage_quota_bytes);
    const next = Number(updates.storage_quota_bytes);
    if (previous !== next) {
      const { data: moved } = await admin
        .from("user_storage")
        .update({ storage_quota_bytes: next })
        .eq("plan_id", id)
        .eq("storage_quota_bytes", previous)
        .select("user_id");
      accountsUpdated = (moved ?? []).length;
    }
  }

  await audit({
    actorId: staff.id,
    actorType: "admin",
    action: "plan.update",
    targetType: "plan",
    targetId: id,
    metadata: {
      fields: Object.keys(updates),
      // What changed, in units a person reads, so the trail is usable after the fact.
      ...(updates.price_cents !== undefined
        ? { priceFrom: Number(existing.price_cents) / 100, priceTo: Number(updates.price_cents) / 100 }
        : {}),
      ...(updates.storage_quota_bytes !== undefined
        ? {
            quotaFromGb: Math.round(Number(existing.storage_quota_bytes) / GIB),
            quotaToGb: Math.round(Number(updates.storage_quota_bytes) / GIB),
            accountsUpdated,
          }
        : {}),
    },
  });

  return { ...mapPlan(updated as unknown as PlanRow), accountsUpdated };
});
