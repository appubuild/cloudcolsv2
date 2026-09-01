import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const identity = await requireAdmin(req);
  return { email: identity.email, name: identity.name, role: identity.role };
});
