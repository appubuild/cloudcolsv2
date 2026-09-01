// Server-side quota helpers. Always validated here, never trusted from clients.

import "server-only";
import { ApiError } from "./auth";
import { createAdminClient } from "@/lib/supabase/server";

export interface QuotaState {
  used: number;
  quota: number;
  planId: string;
  maxFileSizeBytes: number;
}

const PLAN_LIMITS: Record<string, { quota: number; maxFileSize: number }> = {
  plan_free: { quota: 5 * 1024 * 1024 * 1024, maxFileSize: 1 * 1024 * 1024 * 1024 },
  plan_plus: { quota: 100 * 1024 * 1024 * 1024, maxFileSize: 2 * 1024 * 1024 * 1024 },
  plan_pro: { quota: 200 * 1024 * 1024 * 1024, maxFileSize: 3 * 1024 * 1024 * 1024 },
  plan_business: { quota: 1024 * 1024 * 1024 * 1024, maxFileSize: 5 * 1024 * 1024 * 1024 },
};

export async function getQuota(userId: string): Promise<QuotaState> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_storage")
    .select("plan_id, storage_quota_bytes, storage_used_bytes")
    .eq("user_id", userId)
    .maybeSingle();
  const planId = data?.plan_id ?? "plan_free";
  const limits = PLAN_LIMITS[planId] ?? PLAN_LIMITS.plan_free;
  return {
    used: Number(data?.storage_used_bytes ?? 0),
    quota: Number(data?.storage_quota_bytes ?? limits.quota),
    planId,
    maxFileSizeBytes: limits.maxFileSize,
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
