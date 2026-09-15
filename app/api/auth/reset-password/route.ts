import "server-only";
import { limited, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { isolatedAuthClient, isSameOrigin } from "@/lib/api/session";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

interface Body {
  tokenHash?: string;
  password?: string;
}

/**
 * Sets a new password from a reset link.
 *
 * The token in the link is single-use and short-lived; Supabase checks both. Once the
 * password is changed every existing session is ended — someone who needed a reset may
 * not be the only person who knew the old password — and the user signs in afresh.
 */
export const POST = limited(async (req: Request) => {
  if (!isSameOrigin(req)) throw new ApiError("CSRF_REJECTED", 403, "This request did not come from CloudCols.");

  const body = (await req.json().catch(() => ({}))) as Body;
  const tokenHash = String(body.tokenHash ?? "").trim();
  const password = String(body.password ?? "");
  if (!tokenHash) throw new ApiError("INVALID_INPUT", 400, "This reset link is incomplete. Ask for a new one.");
  if (password.length < 8) throw new ApiError("WEAK_PASSWORD", 400, "Password must be at least 8 characters.");

  const { data, error } = await isolatedAuthClient().auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error || !data.user || !data.session) {
    throw new ApiError("LINK_INVALID", 400, "This reset link has expired or was already used. Ask for a new one.");
  }

  const admin = createAdminClient();

  // Sessions end first, while the recovery session that proves who this is still
  // exists to do it with. The other order depended on the password change happening to
  // revoke that session too, which left this call with nothing to act on.
  const { error: signOutError } = await admin.auth.admin.signOut(data.session.access_token, "global");
  if (signOutError) console.error("[reset] could not end existing sessions", signOutError.message);

  const { error: updateError } = await admin.auth.admin.updateUserById(data.user.id, { password });
  if (updateError) throw new ApiError("RESET_FAILED", 400, updateError.message);

  await audit({
    actorId: data.user.id,
    actorType: "user",
    action: "auth.password_reset",
    targetType: "user",
    targetId: data.user.id,
  });

  return { reset: true };
}, DEFAULT_LIMITS.resetPassword);
