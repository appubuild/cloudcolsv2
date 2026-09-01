import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { randomHex } from "@/lib/api/crypto";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

const VALID_EVENTS = ["file.created", "file.updated", "file.deleted", "file.moved", "file.shared", "folder.created", "folder.deleted"];

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("webhooks")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: String(r.id),
    userId: user.id,
    url: String(r.url),
    events: (r.events as string[]) ?? [],
    status: r.status as "active" | "disabled",
    secret: String(r.secret),
    createdAt: String(r.created_at),
    lastDeliveryStatus: (r.last_delivery_status as "ok" | "failed" | "pending" | null) ?? null,
    lastDeliveredAt: r.last_delivered_at ? String(r.last_delivered_at) : null,
  }));
});

interface Body { url?: string; events?: string[] }
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  if (!body.url || !/^https:\/\//.test(body.url)) throw new ApiError("INVALID_URL", 400, "Webhook URL must be HTTPS.");
  const events = (body.events ?? []).filter((e) => VALID_EVENTS.includes(e));
  if (events.length === 0) throw new ApiError("NO_EVENTS", 400, "Select at least one event.");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("webhooks")
    .insert({ user_id: user.id, url: body.url, events, status: "active", secret: `whsec_${randomHex(6)}` })
    .select("*")
    .single();
  if (error) throw new ApiError("CONFLICT", 409, error.message);

  await audit({ actorId: user.id, actorType: "user", action: "webhook.create", targetType: "webhook", targetId: String(data.id), metadata: { url: data.url, events } });
  return {
    id: String(data.id),
    userId: user.id,
    url: String(data.url),
    events: (data.events as string[]) ?? [],
    status: data.status as "active",
    secret: String(data.secret),
    createdAt: String(data.created_at),
    lastDeliveryStatus: null,
    lastDeliveredAt: null,
  };
});
