import "server-only";
import { limited, requireUser, ApiError, DEFAULT_LIMITS, setResponseHeader } from "@/lib/api/auth";
import { verifiedFactor, verifyTotp } from "@/lib/api/mfa";
import { sessionCookies } from "@/lib/api/session";

export const dynamic = "force-dynamic";

interface Body {
  code?: string;
  /** Native clients keep their own tokens; see the login route. */
  tokenMode?: boolean;
}

/**
 * The second step of signing in: the password produced a session that can do nothing
 * yet; a correct code replaces it with one that can.
 *
 * Rate-limited per address on top of Supabase's own limits — six digits is a million
 * guesses, and nothing should let anyone make many of them.
 */
export const POST = limited(async (req: Request) => {
  const user = await requireUser(req, { allowMfaPending: true });
  if (!user.mfaEnabled) throw new ApiError("MFA_NOT_ENABLED", 400, "Two-factor authentication is not on for this account.");

  const factor = await verifiedFactor(user.id);
  if (!factor) throw new ApiError("MFA_NOT_ENABLED", 400, "Two-factor authentication is not on for this account.");

  const body = (await req.json().catch(() => ({}))) as Body;
  const tokens = await verifyTotp(user.accessToken, factor.id, body.code);
  for (const c of sessionCookies(req, tokens)) setResponseHeader(req, "set-cookie", c);

  return {
    verified: true,
    ...(body.tokenMode ? { token: tokens.accessToken, refreshToken: tokens.refreshToken } : {}),
  };
}, DEFAULT_LIMITS.mfa);
