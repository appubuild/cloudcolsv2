// User storage-profile helpers. Ensures a user_storage row exists for every
// auth user (lazy provision on signup / first login), and applies plan quotas.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { defaultPlan } from "@/lib/plans/catalog";

const COLUMNS =
  "user_id, plan_id, storage_quota_bytes, storage_used_bytes, developer_enabled, status, display_name, avatar_url";

export async function ensureProfile(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("user_storage").select(COLUMNS).eq("user_id", userId).maybeSingle();
  if (data) return data;

  // A new account gets whatever plan is marked default, at that plan's quota. This
  // used to be a 5 GB constant in this file, which meant changing the free plan's
  // storage in the admin panel changed it for everyone except the people signing
  // up — the one group whose quota the number was actually deciding.
  const plan = await defaultPlan();
  const { data: created, error } = await admin
    .from("user_storage")
    .upsert(
      {
        user_id: userId,
        plan_id: plan.id,
        storage_quota_bytes: plan.storageQuotaBytes,
        status: "active",
      },
      { onConflict: "user_id" },
    )
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return created;
}
