import "server-only";
import { handler, requireUser } from "@/lib/api/auth";
import { countRecoveryCodes } from "@/lib/api/mfa";

export const dynamic = "force-dynamic";

/**
 * Whether 2FA is on, and whether this session still owes its second factor.
 *
 * Answers a half-finished sign-in too — the sign-in page asks this to know whether to
 * show the code step after a reload.
 */
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req, { allowMfaPending: true });
  return {
    enabled: user.mfaEnabled,
    pending: user.mfaEnabled && user.aal !== "aal2",
    recoveryCodesLeft: user.mfaEnabled ? await countRecoveryCodes(user.id) : 0,
  };
});
