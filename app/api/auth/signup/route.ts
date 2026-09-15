import "server-only";
import { limited, ApiError, DEFAULT_LIMITS, setResponseHeader } from "@/lib/api/auth";
import { ensureProfile } from "@/lib/api/profiles";
import { isolatedAuthClient, isSameOrigin, sessionCookies, tokensFrom, appOrigin } from "@/lib/api/session";
import { email } from "@/lib/email";
import { getSetting } from "@/lib/settings/system";

export const dynamic = "force-dynamic";

interface SignupBody {
  name: string;
  email: string;
  password: string;
}

export const POST = limited(async (req: Request) => {
  // Checked before anything is validated or created. An admin who has closed
  // registration has closed it, and the answer should not depend on whether the
  // form happened to be filled in correctly.
  if (!(await getSetting("registration_enabled"))) {
    throw new ApiError("REGISTRATION_CLOSED", 403, "New registrations are closed right now.");
  }

  if (!isSameOrigin(req)) throw new ApiError("CSRF_REJECTED", 403, "This request did not come from CloudCols.");

  const body = (await req.json().catch(() => ({}))) as SignupBody;
  if (!body.name?.trim()) throw new ApiError("INVALID_INPUT", 400, "Name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email ?? ""))
    throw new ApiError("INVALID_INPUT", 400, "Enter a valid email.");
  if (!body.password || body.password.length < 8)
    throw new ApiError("WEAK_PASSWORD", 400, "Password must be at least 8 characters.");

  // A client of its own, like login: the session it may hand back must not end up
  // attached to anything that writes afterwards (lib/api/password.ts).
  const { data, error } = await isolatedAuthClient().auth.signUp({
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

  // Signed in straight away when the project does not require email confirmation.
  if (data.session) {
    for (const c of sessionCookies(req, tokensFrom(data.session))) setResponseHeader(req, "set-cookie", c);
  }

  // Fire a welcome email (async, non-blocking, logged if no provider configured).
  email.welcome(data.user.email ?? "", {
    name: body.name.trim(),
    quota: `${Math.round(profile.storage_quota_bytes / 1024 / 1024 / 1024)} GB`,
    link: `${appOrigin(req)}/app`,
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
