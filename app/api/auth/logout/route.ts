import "server-only";
import { handler, requireUser, setResponseHeader, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { clearedSessionCookies, isSameOrigin } from "@/lib/api/session";
import { clearedDeliveryCookie } from "@/lib/api/deliverySession";

export const dynamic = "force-dynamic";

/**
 * Signing out.
 *
 * This used to do nothing: the browser threw away its own copy of the session and
 * the refresh token stayed valid at Supabase, able to mint new sessions for as long as
 * anyone who had copied it wanted. Now the session is ended at Supabase, so its refresh
 * token is dead, and every cookie that carried it is cleared — the delivery cookie
 * included, so file links stop working in this browser too.
 *
 * The access token itself cannot be recalled: it is checked locally and lives out its
 * hour. With the cookie gone the browser no longer sends it, which is what matters.
 */
export const POST = handler(async (req: Request) => {
  // Refused from another site: being signed out by a page you merely visited is a
  // nuisance an attacker should not get to cause.
  if (!isSameOrigin(req)) throw new ApiError("CSRF_REJECTED", 403, "This request did not come from CloudCols.");

  let revoked = false;
  try {
    const user = await requireUser(req);
    const { error } = await createAdminClient().auth.admin.signOut(user.accessToken, "local");
    revoked = !error;
  } catch {
    // No live session to end. The cookies are cleared regardless.
  }

  for (const c of clearedSessionCookies(req)) setResponseHeader(req, "set-cookie", c);
  const delivery = clearedDeliveryCookie(req);
  if (delivery) setResponseHeader(req, "set-cookie", delivery);

  return { signedOut: true, revoked };
});
