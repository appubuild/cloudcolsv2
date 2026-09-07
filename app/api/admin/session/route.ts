import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { issueAdminToken } from "@/lib/api/adminAuth";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

/**
 * Whether the signed-in account is staff, and a staff session if it is.
 *
 * /admin/login used to show its password form to everyone, including someone who had
 * just signed in to the app seconds earlier and whose account is an admin. They typed
 * the same password again. And someone with no admin rights got the same form, tried,
 * and was told their credentials were invalid — which is not what was wrong.
 *
 * This answers the question the page should have been asking. The Supabase session
 * already proves who they are; what is left is whether that identity is in `admins`.
 *
 * Note the trade-off: this removes the second password prompt for reaching the admin
 * panel. The password form is still there for anyone not signed in, so nothing is
 * lost for a fresh browser — but if you want re-authentication to be mandatory for
 * staff, this endpoint is the thing to remove.
 */
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const client = createAdminClient();

  const { data: staff } = await client
    .from("admins")
    .select("id, user_id, email, name, role, is_active")
    .eq("email", user.email.trim().toLowerCase())
    .maybeSingle();

  // Not staff, or staff who have been switched off. Both answer the same way: the
  // page needs to say "you cannot go here", not "your password was wrong".
  if (!staff || !staff.is_active) {
    return { isAdmin: false as const, token: null, role: null };
  }

  const identity = {
    id: String(staff.id),
    userId: staff.user_id ? String(staff.user_id) : null,
    email: String(staff.email),
    name: String(staff.name ?? ""),
    role: staff.role as "super_admin" | "support" | "operator",
  };

  await client.from("admins").update({ last_login_at: new Date().toISOString() }).eq("id", staff.id);
  await audit({
    actorId: identity.id,
    actorType: "admin",
    action: "admin.session_from_user",
    targetType: "admin",
    targetId: identity.id,
    metadata: { email: identity.email, role: identity.role },
  });

  return { isAdmin: true as const, token: issueAdminToken(identity), role: identity.role };
});
