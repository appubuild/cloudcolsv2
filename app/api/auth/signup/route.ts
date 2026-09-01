import "server-only";
import { limited, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/api/profiles";
import { email } from "@/lib/email";

export const dynamic = "force-dynamic";

interface SignupBody {
  name: string;
  email: string;
  password: string;
}

export const POST = limited(async (req: Request) => {
  const body = (await req.json()) as SignupBody;
  if (!body.name?.trim()) throw new ApiError("INVALID_INPUT", 400, "Name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email ?? ""))
    throw new ApiError("INVALID_INPUT", 400, "Enter a valid email.");
  if (!body.password || body.password.length < 8)
    throw new ApiError("WEAK_PASSWORD", 400, "Password must be at least 8 characters.");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.signUp({
    email: body.email.trim(),
    password: body.password,
    options: { data: { name: body.name.trim(), full_name: body.name.trim() } },
  });
  if (error) {
    if (error.message.toLowerCase().includes("already")) throw new ApiError("EMAIL_TAKEN", 409, "An account with this email already exists.");
    throw new ApiError("SIGNUP_FAILED", 400, error.message);
  }
  if (!data.user) throw new ApiError("SIGNUP_FAILED", 400, "Could not create account.");

  const profile = await ensureProfile(data.user.id);

  // Fire a welcome email (async, non-blocking, logged if no provider configured).
  email.welcome(data.user.email ?? "", {
    name: body.name.trim(),
    quota: `${Math.round(profile.storage_quota_bytes / 1024 / 1024 / 1024)} GB`,
    link: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/app`,
  }).catch(() => {});

  return {
    needsEmailConfirm: data.session == null,
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
}, DEFAULT_LIMITS.signup);
