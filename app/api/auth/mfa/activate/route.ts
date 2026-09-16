import "server-only";
import { limited, requireUser, ApiError, DEFAULT_LIMITS, setResponseHeader } from "@/lib/api/auth";
import { listTotpFactors, verifyTotp, setMfaEnabled, replaceRecoveryCodes } from "@/lib/api/mfa";
import { sessionCookies } from "@/lib/api/session";
import { audit } from "@/lib/api/audit";
import { notify } from "@/lib/notifications";

export const dynamic = "force-dynamic";

interface Body {
  factorId?: string;
  code?: string;
}

/**
 * Finishes setup: the first code from the app proves it was set up correctly, and only
 * then is 2FA switched on. Returns the recovery codes — the only time they are shown.
 */
export const POST = limited(async (req: Request) => {
  const user = await requireUser(req);
  if (user.mfaEnabled) throw new ApiError("MFA_ALREADY_ENABLED", 409, "Two-factor authentication is already on.");

  const body = (await req.json().catch(() => ({}))) as Body;
  const factor = (await listTotpFactors(user.id)).find((f) => f.id === body.factorId);
  if (!factor) throw new ApiError("NOT_FOUND", 404, "This setup has expired. Start again.");

  const tokens = await verifyTotp(user.accessToken, factor.id, body.code);
  await setMfaEnabled(user.id, true);
  const recoveryCodes = await replaceRecoveryCodes(user.id);

  // The session this browser holds is now the stronger one, so turning 2FA on does not
  // immediately ask for the code that was just typed.
  for (const c of sessionCookies(req, tokens)) setResponseHeader(req, "set-cookie", c);

  await audit({ actorId: user.id, actorType: "user", action: "auth.mfa_enabled", targetType: "user", targetId: user.id });
  await notify({
    userId: user.id,
    type: "security",
    title: "Two-factor authentication is on",
    body: "Signing in now needs a code from your authenticator app. Keep your recovery codes somewhere safe.",
    link: "/app/settings",
  });

  return { enabled: true, recoveryCodes };
}, DEFAULT_LIMITS.mfa);
