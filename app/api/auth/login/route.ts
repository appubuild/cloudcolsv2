import "server-only";
import { limited, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/api/profiles";
import { checkPassword } from "@/lib/api/password";

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

  // On its own client — see lib/api/password.ts for why that matters.
  const signedIn = await checkPassword(body.email, body.password);
  if (!signedIn) {
    throw new ApiError("INVALID_CREDENTIALS", 401, "Invalid email or password.");
  }
  const { session, user } = signedIn;

  const profile = await ensureProfile(user.id);

  // Signing in is activity: any inactivity warning already sent no longer applies,
  // and a later lapse is warned about from the start (lib/jobs/inactivity.ts).
  const { error: touchError } = await createAdminClient()
    .from("user_storage")
    .update({ last_login_at: new Date().toISOString(), inactivity_stage: null })
    .eq("user_id", user.id);
  if (touchError) console.error("[login] could not record sign-in", touchError.message);

  return {
    token: session.access_token,
    user: {
      id: user.id,
      email: user.email ?? "",
      planId: profile.plan_id,
      storageQuotaBytes: profile.storage_quota_bytes,
      storageUsedBytes: profile.storage_used_bytes,
      developerEnabled: profile.developer_enabled,
      status: profile.status,
    },
  };
}, DEFAULT_LIMITS.login);
