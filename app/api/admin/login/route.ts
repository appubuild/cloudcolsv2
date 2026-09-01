import { handler, ApiError, limited, DEFAULT_LIMITS } from "@/lib/api/auth";
import { authenticateAdmin, issueAdminToken } from "@/lib/api/adminAuth";

export const dynamic = "force-dynamic";

interface Body { email: string; password: string }
export const POST = limited(async (req: Request) => {
  const body = (await req.json()) as Body;
  if (!body.email?.trim() || !body.password) throw new ApiError("INVALID_INPUT", 400, "Email and password are required.");
  const identity = await authenticateAdmin(body.email, body.password);
  const token = issueAdminToken(identity);
  return { token, identity: { email: identity.email, name: identity.name, role: identity.role } };
}, DEFAULT_LIMITS.login);
