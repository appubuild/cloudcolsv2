import { handler, requireUser, ApiError, limited, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

interface Body { currentPassword: string; newPassword: string }
export const POST = limited(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  if (!body.currentPassword) throw new ApiError("INVALID_INPUT", 400, "Current password is required.");
  if (String(body.newPassword ?? "").length < 8) throw new ApiError("INVALID_INPUT", 400, "New password must be at least 8 characters.");

  // Verify the current password against Supabase Auth before changing.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new ApiError("CONFIG", 503, "Authentication is not configured.");
  const verify = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anon },
    body: JSON.stringify({ email: user.email, password: body.currentPassword }),
  });
  if (!verify.ok) throw new ApiError("INVALID_CREDENTIALS", 401, "Current password is incorrect.");

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: body.newPassword });
  if (error) throw new ApiError("PASSWORD_FAILED", 400, error.message);

  await audit({ actorId: user.id, actorType: "user", action: "auth.change_password", targetType: "user", targetId: user.id });
  return { changed: true };
}, DEFAULT_LIMITS.reset);
