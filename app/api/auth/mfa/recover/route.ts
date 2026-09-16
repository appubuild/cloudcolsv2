import "server-only";
import { limited, requireUser, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { consumeRecoveryCode, turnOffMfa } from "@/lib/api/mfa";
import { audit } from "@/lib/api/audit";
import { notify } from "@/lib/notifications";

export const dynamic = "force-dynamic";

interface Body {
  code?: string;
}

/**
 * A lost phone: one recovery code, after the password, turns 2FA off so the account can
 * be reached again. The session is then complete as it stands — with 2FA off, a
 * password is all it needs — and the user is asked to set 2FA up again.
 *
 * Turning it off rather than signing in once: the device that produced the codes is
 * gone, so leaving 2FA on would lock the account again at the next sign-in.
 */
export const POST = limited(async (req: Request) => {
  const user = await requireUser(req, { allowMfaPending: true });
  if (!user.mfaEnabled) throw new ApiError("MFA_NOT_ENABLED", 400, "Two-factor authentication is not on for this account.");

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!(await consumeRecoveryCode(user.id, body.code))) {
    throw new ApiError("INVALID_CODE", 400, "That recovery code is not valid, or has already been used.");
  }

  await turnOffMfa(user.id);
  await audit({ actorId: user.id, actorType: "user", action: "auth.mfa_recovered", targetType: "user", targetId: user.id });
  await notify({
    userId: user.id,
    type: "security",
    title: "Two-factor authentication was turned off with a recovery code",
    body: "Set it up again on your new device. If this was not you, change your password now.",
    link: "/app/settings",
  });

  return { disabled: true };
}, DEFAULT_LIMITS.mfa);
