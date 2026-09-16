import "server-only";
import { limited, requireUser, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { verifiedFactor, verifyTotp, replaceRecoveryCodes } from "@/lib/api/mfa";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

interface Body {
  code?: string;
}

/** A new set of recovery codes, replacing the old set entirely. Needs a current code. */
export const POST = limited(async (req: Request) => {
  const user = await requireUser(req);
  if (!user.mfaEnabled) throw new ApiError("MFA_NOT_ENABLED", 400, "Two-factor authentication is not on.");

  const factor = await verifiedFactor(user.id);
  if (!factor) throw new ApiError("MFA_NOT_ENABLED", 400, "Two-factor authentication is not on.");
  const body = (await req.json().catch(() => ({}))) as Body;
  await verifyTotp(user.accessToken, factor.id, body.code);

  const recoveryCodes = await replaceRecoveryCodes(user.id);
  await audit({ actorId: user.id, actorType: "user", action: "auth.mfa_recovery_codes_replaced", targetType: "user", targetId: user.id });
  return { recoveryCodes };
}, DEFAULT_LIMITS.mfa);
