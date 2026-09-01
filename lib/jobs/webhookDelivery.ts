// Async webhook delivery.
// Events are dispatched to configured endpoints asynchronously, signed with the
// endpoint secret (HMAC-SHA256), with simple retry. Normal file operations are
// NEVER blocked on delivery — this runs in the background.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { hmacSign } from "@/lib/api/crypto";
import { audit } from "@/lib/api/audit";

export interface WebhookEvent {
  id: string;
  type: string; // e.g. file.created
  objectKey?: string;
  fileId?: string;
  folderId?: string;
  ownerId?: string;
  timestamp: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export async function deliver(event: WebhookEvent, userId?: string): Promise<void> {
  const admin = createAdminClient();
  const query = admin.from("webhooks").select("*").eq("status", "active");
  const { data: hooks, error } = userId
    ? await query.eq("user_id", userId)
    : await query;
  if (error) return;

  const eventKey = event.type;
  for (const hook of (hooks ?? [])) {
    const events = (hook.events as string[]) ?? [];
    if (!events.includes(eventKey)) continue;
    await deliverToUrl(hook as never, event);
  }
}

async function deliverToUrl(hook: { id: string; url: string; secret: string; user_id: string }, event: WebhookEvent): Promise<void> {
  const payload = JSON.stringify(event);
  const signature = hmacSign(hook.secret, payload);
  let ok = false;
  let attempt = 0;

  while (attempt < MAX_RETRIES && !ok) {
    attempt += 1;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(hook.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cloudcols-signature": `sha256=${signature}` },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok && attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
  }

  const admin = createAdminClient();
  await admin
    .from("webhooks")
    .update({ last_delivery_status: ok ? "ok" : "failed", last_delivered_at: new Date().toISOString() })
    .eq("id", hook.id);
  await audit({
    actorId: hook.user_id,
    actorType: "user",
    action: `webhook.deliver_${ok ? "ok" : "failed"}`,
    targetType: "webhook",
    targetId: hook.id,
    metadata: { event: event.type, attempts: attempt },
  });
}

// Manual trigger for a batch (used by jobs runner / tests).
export async function runWebhookDelivery(data?: { event?: WebhookEvent; userId?: string }): Promise<string> {
  if (!data?.event) return "Webhook delivery requires an event.";
  await deliver(data.event, data.userId);
  return `Dispatching ${data.event.type}`;
}
