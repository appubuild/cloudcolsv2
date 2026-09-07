// Server-side quota helpers. Always validated here, never trusted from clients.

import "server-only";
import { ApiError } from "./auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getPlan, defaultPlan } from "@/lib/plans/catalog";
import { getSetting } from "@/lib/settings/system";

export interface QuotaState {
  used: number;
  quota: number;
  planId: string;
  maxFileSizeBytes: number;
}

/**
 * What the account may currently store, and how big one file may be.
 *
 * The limits used to live in a table in this file — one of five copies of the plan
 * catalogue. They now come from the `plans` table, so raising a plan's max file
 * size in the admin panel raises it here too, which is what "admin-configurable"
 * was supposed to mean.
 *
 * The quota itself still comes from the account's own row rather than the plan: a
 * grandfathered or manually-adjusted account keeps what it was given. The plan is
 * the fallback for an account that somehow has none.
 */
export async function getQuota(userId: string): Promise<QuotaState> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_storage")
    .select("plan_id, storage_quota_bytes, storage_used_bytes")
    .eq("user_id", userId)
    .maybeSingle();

  const [fallback, ceiling] = await Promise.all([defaultPlan(), getSetting("max_file_size_bytes")]);
  const planId = data?.plan_id ? String(data.plan_id) : fallback.id;
  // An account on a plan that no longer exists is not given the benefit of the
  // doubt: it drops to the default plan's file-size limit rather than an
  // accidentally unlimited one.
  const plan = (await getPlan(planId)) ?? fallback;

  return {
    used: Number(data?.storage_used_bytes ?? 0),
    quota: Number(data?.storage_quota_bytes ?? plan.storageQuotaBytes),
    planId,
    // The plan's limit, capped by the platform-wide ceiling an admin sets. Whichever
    // is lower wins: lowering the ceiling has to actually lower it for everyone,
    // including whatever the most generous plan allows.
    maxFileSizeBytes: Math.min(plan.maxFileSizeBytes, ceiling),
  };
}

/** Throws QUOTA_EXCEEDED / FILE_TOO_LARGE if the upload is not allowed. */
export function assertCanUpload(quota: QuotaState, sizeBytes: number) {
  if (sizeBytes <= 0) throw new ApiError("INVALID_INPUT", 400, "File size must be positive.");
  if (quota.used + sizeBytes > quota.quota) {
    throw new ApiError("QUOTA_EXCEEDED", 413, "Storage quota exceeded. Upgrade your plan to continue.");
  }
  if (sizeBytes > quota.maxFileSizeBytes) {
    throw new ApiError("FILE_TOO_LARGE", 413, `File exceeds the ${Math.round(quota.maxFileSizeBytes / 1e6)} MB limit for your plan.`);
  }
}
