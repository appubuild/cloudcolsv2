import "server-only";
import { limited, requireUser, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { verifiedFactor, verifyTotp, turnOffMfa } from "@/lib/api/mfa";
import { audit } from "@/lib/api/audit";
import { notify } from "@/lib/notifications";

export const dynamic = "force-dynamic";

interface Body {
  code?: string;
}

/**
 * Turns 2FA off. Needs a fully signed-in session (requireUser insists on the second
 * factor while 2FA is on) and a current code as well — someone at an unlocked
 * computer should not be able to remove the protection with a click.
 */
export const POST = limited(async (req: Request) => {
  const user = await requireUser(req);
  if (!user.mfaEnabled) throw new ApiError("MFA_NOT_ENABLED", 400, "Two-factor authentication is not on.");

  const factor = await verifiedFactor(user.id);
  const body = (await req.json().catch(() => ({}))) as Body;
  if (factor) await verifyTotp(user.accessToken, factor.id, body.code);

  await turnOffMfa(user.id);
  await audit({ actorId: user.id, actorType: "user", action: "auth.mfa_disabled", targetType: "user", targetId: user.id });
  await notify({
    userId: user.id,
    type: "security",
    title: "Two-factor authentication is off",
    body: "Signing in needs only your password now. If this was not you, change your password.",
    link: "/app/settings",
  });

  return { disabled: true };
}, DEFAULT_LIMITS.mfa);
