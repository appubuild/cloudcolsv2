import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { mapUserProfile } from "@/lib/api/mappers";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

// Update the user's profile metadata (name/display). Email is immutable here —
// email changes go through Supabase's dedicated confirm-email flow.
interface Body { name?: string; avatarUrl?: string | null }
export const PATCH = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  if (body.name !== undefined && String(body.name).trim().length > 0 && String(body.name).trim().length > 80) {
    throw new ApiError("INVALID_INPUT", 400, "Name must be under 80 characters.");
  }
  if (body.avatarUrl !== undefined && typeof body.avatarUrl !== "string" && body.avatarUrl !== null) {
    throw new ApiError("INVALID_INPUT", 400, "Invalid avatar URL.");
  }

  const admin = createAdminClient();
  const updates: Record<string, unknown> = {};
  if (body.name && body.name.trim()) updates.display_name = body.name.trim();
  if (body.avatarUrl !== undefined) updates.avatar_url = body.avatarUrl;

  let updated: Record<string, unknown> | null = null;
  if (Object.keys(updates).length) {
    const { data, error } = await admin.from("user_storage").update(updates).eq("user_id", user.id).select("*").maybeSingle();
    if (error) throw error;
    updated = data as unknown as Record<string, unknown> | null;
    await audit({ actorId: user.id, actorType: "user", action: "profile.update", targetType: "user", targetId: user.id, metadata: { fields: Object.keys(updates) } });
  }

  const { data: row } = updated
    ? { data: updated }
    : await admin.from("user_storage").select("*").eq("user_id", user.id).maybeSingle();
  if (!row) throw new ApiError("NOT_FOUND", 404, "Profile not found.");

  return mapUserProfile(row as Record<string, unknown>, user);
});
