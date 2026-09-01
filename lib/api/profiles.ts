// User storage-profile helpers. Ensures a user_storage row exists for every
// auth user (lazy provision on signup / first login), and applies plan quotas.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

const FREE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

export async function ensureProfile(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_storage")
    .select("user_id, plan_id, storage_quota_bytes, storage_used_bytes, developer_enabled, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data;
  // Create with free plan defaults.
  const { data: created, error } = await admin
    .from("user_storage")
    .upsert(
      { user_id: userId, plan_id: "plan_free", storage_quota_bytes: FREE_QUOTA_BYTES, status: "active" },
      { onConflict: "user_id" }
    )
    .select("user_id, plan_id, storage_quota_bytes, storage_used_bytes, developer_enabled, status")
    .single();
  if (error) throw error;
  return created;
}
