// Server-side audit logging. Every security-relevant and destructive action is
// recorded (with actor, action, target, and metadata) so operations are traceable.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export interface AuditInput {
  actorId?: string | null;
  actorType?: "user" | "admin" | "system";
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write an audit log entry. Fire-and-forget style: does not throw into the
 * caller's flow, so a logging failure never breaks a user operation.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("audit_logs").insert({
      actor_id: input.actorId ?? null,
      actor_type: input.actorType ?? "system",
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      metadata: input.metadata ?? {},
    });
  } catch (e) {
    console.error("[audit] failed to write log", input.action, (e as Error).message);
  }
}
