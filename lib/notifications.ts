// In-app notifications: the bell in the top bar.
//
// One place that writes them, so every event is shaped the same way and no caller has
// to remember the rule below. Callers are all server-side, on the service-role client;
// browsers cannot write this table (migration 0023).
//
// The rule: a notification is never the durable record of anything. The invitation,
// the payment, the audit entry is — the notification only points at it. So a failed
// insert must not fail the operation that caused it. What it must not do either is
// vanish: the two inserts this replaces discarded the error Supabase returned, so a
// broken insert would have looked exactly like one that nobody triggered. Failures are
// logged instead.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export type NotificationType =
  | "share_invitation"
  | "share_response"
  | "payment_succeeded"
  | "payment_failed"
  | "subscription_canceled"
  | "inactivity_warning"
  | "inactivity_final";

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** An in-app path. Never an external URL: the bell renders it as a link. */
  link?: string;
}

const MAX_TITLE = 200;
const MAX_BODY = 500;

export async function notify(input: NotificationInput): Promise<void> {
  const link = input.link && input.link.startsWith("/") && !input.link.startsWith("//") ? input.link : null;
  try {
    const { error } = await createAdminClient()
      .from("notifications")
      .insert({
        user_id: input.userId,
        type: input.type,
        title: input.title.slice(0, MAX_TITLE),
        body: (input.body ?? "").slice(0, MAX_BODY),
        link,
      });
    if (error) console.error("[notify] insert failed", input.type, error.message);
  } catch (e) {
    console.error("[notify] insert threw", input.type, (e as Error).message);
  }
}
