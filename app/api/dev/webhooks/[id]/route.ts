import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

type Params = { id: string };

interface Body { status?: "active" | "disabled"; url?: string }
export const PATCH = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const body = (await req.json()) as Body;
  const admin = createAdminClient();
  const updates: Record<string, unknown> = {};
  if (body.status) updates.status = body.status;
  if (body.url) updates.url = body.url;

  const { data, error } = await admin
    .from("webhooks")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("NOT_FOUND", 404, "Webhook not found.");
  return {
    id: String(data.id),
    userId: user.id,
    url: String(data.url),
    events: (data.events as string[]) ?? [],
    status: data.status as "active" | "disabled",
    secret: String(data.secret),
    createdAt: String(data.created_at),
    lastDeliveryStatus: (data.last_delivery_status as "ok" | "failed" | "pending" | null) ?? null,
    lastDeliveredAt: data.last_delivered_at ? String(data.last_delivered_at) : null,
  };
});

export const DELETE = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const admin = createAdminClient();
  const { error } = await admin.from("webhooks").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw error;
  await audit({ actorId: user.id, actorType: "user", action: "webhook.delete", targetType: "webhook", targetId: id });
  return { deleted: true };
});
