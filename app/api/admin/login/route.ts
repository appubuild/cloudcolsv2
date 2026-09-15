import { ApiError, limited, DEFAULT_LIMITS, setResponseHeader } from "@/lib/api/auth";
import { authenticateAdmin, issueAdminToken, adminSessionCookie } from "@/lib/api/adminAuth";
import { isSameOrigin } from "@/lib/api/session";

export const dynamic = "force-dynamic";

interface Body { email: string; password: string }

/** Staff sign-in. The session is set as an httpOnly cookie; the token is never returned. */
export const POST = limited(async (req: Request) => {
  if (!isSameOrigin(req)) throw new ApiError("CSRF_REJECTED", 403, "This request did not come from CloudCols.");
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.email?.trim() || !body.password) throw new ApiError("INVALID_INPUT", 400, "Email and password are required.");
  const identity = await authenticateAdmin(body.email, body.password);
  setResponseHeader(req, "set-cookie", adminSessionCookie(req, issueAdminToken(identity)));
  return { identity: { email: identity.email, name: identity.name, role: identity.role } };
}, DEFAULT_LIMITS.login);
