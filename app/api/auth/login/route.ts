import "server-only";
import { limited, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/api/profiles";

export const dynamic = "force-dynamic";

interface LoginBody {
  email: string;
  password: string;
}

export const POST = limited(async (req: Request) => {
  const body = (await req.json()) as LoginBody;
  if (!body.email || !body.password) {
    throw new ApiError("INVALID_INPUT", 400, "Email and password are required.");
  }
  const admin = createAdminClient();
  const { data, error } = await admin.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });
  if (error || !data.session) {
    throw new ApiError("INVALID_CREDENTIALS", 401, "Invalid email or password.");
  }
  const profile = await ensureProfile(data.user.id);
  await admin
    .from("user_storage")
    .update({ last_login_at: new Date().toISOString() })
    .eq("user_id", data.user.id);

  return {
    token: data.session.access_token,
    user: {
      id: data.user.id,
      email: data.user.email ?? "",
      planId: profile.plan_id,
      storageQuotaBytes: profile.storage_quota_bytes,
      storageUsedBytes: profile.storage_used_bytes,
      developerEnabled: profile.developer_enabled,
      status: profile.status,
    },
  };
}, DEFAULT_LIMITS.login);
