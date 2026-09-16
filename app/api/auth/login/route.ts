import "server-only";
import { limited, ApiError, DEFAULT_LIMITS, setResponseHeader } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/api/profiles";
import { checkPassword } from "@/lib/api/password";
import { isSameOrigin, sessionCookies, tokensFrom } from "@/lib/api/session";

export const dynamic = "force-dynamic";

interface LoginBody {
  email: string;
  password: string;
  /**
   * Native clients (the mobile app) keep their own tokens and ask for them. The web
   * app does not: its session is set as httpOnly cookies and never reaches page script.
   */
  tokenMode?: boolean;
}

export const POST = limited(async (req: Request) => {
  // Another site must not be able to sign a visitor in to an account of its choosing.
  if (!isSameOrigin(req)) throw new ApiError("CSRF_REJECTED", 403, "This request did not come from CloudCols.");

  const body = (await req.json().catch(() => ({}))) as LoginBody;
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
  // The same write reports whether 2FA is on, so asking costs no extra query.
  const { data: account, error: touchError } = await createAdminClient()
    .from("user_storage")
    .update({ last_login_at: new Date().toISOString(), inactivity_stage: null })
    .eq("user_id", user.id)
    .select("mfa_enabled")
    .maybeSingle();
  if (touchError) console.error("[login] could not record sign-in", touchError.message);

  // With 2FA on, the session set below has passed the password only. requireUser
  // refuses it everywhere until /api/auth/mfa/verify upgrades it; this flag just tells
  // the page to ask for the code now rather than find out on the next request.
  const mfaRequired = Boolean(account?.mfa_enabled);

  const tokens = tokensFrom(session);
  for (const c of sessionCookies(req, tokens)) setResponseHeader(req, "set-cookie", c);

  return {
    mfaRequired,
    ...(body.tokenMode ? { token: tokens.accessToken, refreshToken: tokens.refreshToken } : {}),
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
