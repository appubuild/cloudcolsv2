import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

type Params = { id: string };

interface Body {
  status?: "active" | "revoked";
  label?: string;
}

// Rename / revoke an API key (owner-scoped).
export const PATCH = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const body = (await req.json()) as Body;
  const admin = createAdminClient();
  const updates: Record<string, unknown> = {};
  if (body.status) updates.status = body.status;
  if (typeof body.label === "string" && body.label.trim()) updates.label = body.label.trim();

  const { data, error } = await admin
    .from("api_keys")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("NOT_FOUND", 404, "API key not found.");

  await audit({ actorId: user.id, actorType: "user", action: updates.status ? "api_key.revoke" : "api_key.rename", targetType: "api_key", targetId: id, metadata: { status: data.status } });
  return { id: String(data.id), status: data.status, label: String(data.label) };
});

export const DELETE = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const admin = createAdminClient();
  const { error } = await admin.from("api_keys").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw error;
  await audit({ actorId: user.id, actorType: "user", action: "api_key.delete", targetType: "api_key", targetId: id });
  return { deleted: true };
});
