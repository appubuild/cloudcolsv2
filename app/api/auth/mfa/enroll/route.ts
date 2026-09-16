import "server-only";
import { limited, requireUser, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { enrollTotp, removeTotpFactors } from "@/lib/api/mfa";

export const dynamic = "force-dynamic";

/** Starts setting up an authenticator app: returns the QR code and the secret behind it. */
export const POST = limited(async (req: Request) => {
  const user = await requireUser(req);
  if (user.mfaEnabled) throw new ApiError("MFA_ALREADY_ENABLED", 409, "Two-factor authentication is already on.");

  // A setup that was started and abandoned leaves an unverified factor behind, and
  // Supabase refuses a second one under the same name. While 2FA is off, no factor
  // should exist at all, so any that do are cleared first.
  await removeTotpFactors(user.id);

  return enrollTotp(user.accessToken);
}, DEFAULT_LIMITS.mfa);
