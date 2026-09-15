import { handler, setResponseHeader } from "@/lib/api/auth";
import { clearedAdminCookie } from "@/lib/api/adminAuth";

export const dynamic = "force-dynamic";

/**
 * Staff sign-out: clears the httpOnly staff cookie. The token inside is stateless and
 * short-lived (six hours); without the cookie this browser no longer presents it.
 */
export const POST = handler(async (req: Request) => {
  setResponseHeader(req, "set-cookie", clearedAdminCookie(req));
  return { loggedOut: true };
});
