// Inactivity policy.
// Configurable workflow: warning → final warning → grace period → deletion.
// Backend-enforced; never triggered by the client. Email notifications are sent
// at each stage, and all automated actions are audited.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { email } from "@/lib/email";
import { audit } from "@/lib/api/audit";

export interface InactivityPolicy {
  inactiveDays: number;
  warningDays: number;
  finalWarningDays: number;
  graceDays: number;
}

export function policy(): InactivityPolicy {
  const n = (k: string, dflt: number) => {
    const v = Number(process.env[k] ?? dflt);
    return Number.isFinite(v) && v > 0 ? v : dflt;
  };
  return {
    inactiveDays: n("INACTIVITY_DAYS", 90),
    warningDays: n("INACTIVITY_WARNING_DAYS", 30),
    finalWarningDays: n("INACTIVITY_FINAL_WARNING_DAYS", 15),
    graceDays: n("INACTIVITY_GRACE_DAYS", 7),
  };
}

export async function runInactivityPolicy(data?: { dryRun?: boolean }): Promise<string> {
  const p = policy();
  const admin = createAdminClient();
  const cutoff = Date.now() - p.inactiveDays * 86400000;

  const { data: users, error } = await admin
    .from("user_storage")
    .select("user_id, plan_id, status, last_login_at, created_at")
    .eq("status", "active");
  if (error) return `Inactivity policy failed: ${error.message}`;

  let warned = 0, finalWarned = 0, scheduled = 0;

  for (const u of (users ?? [])) {
    const lastActivity = u.last_login_at ? new Date(u.last_login_at).getTime() : new Date(u.created_at).getTime();
    const daysInactive = Math.floor((Date.now() - lastActivity) / 86400000);

    if (daysInactive < p.inactiveDays) continue;

    const { data: profile } = await admin.auth.admin.getUserById(u.user_id);
    const emailAddr = profile?.user?.email;

    if (daysInactive >= p.inactiveDays + p.warningDays + p.finalWarningDays + p.graceDays) {
      // Beyond grace → mark pending deletion (deletion itself is a separate, explicit step).
      if (!data?.dryRun) {
        await admin.from("user_storage").update({ status: "pending_deletion" }).eq("user_id", u.user_id);
        if (emailAddr) await email.inactiveFinal(emailAddr, { name: emailAddr.split("@")[0] ?? "there", grace: String(p.graceDays) }).catch(() => {});
        await audit({ actorType: "system", action: "user.schedule_deletion", targetType: "user", targetId: String(u.user_id), metadata: { daysInactive } });
        scheduled += 1;
      }
    } else if (daysInactive >= p.inactiveDays + p.warningDays + p.finalWarningDays) {
      if (!data?.dryRun) {
        if (emailAddr) await email.inactiveFinal(emailAddr, { name: emailAddr.split("@")[0] ?? "there", grace: String(p.graceDays) }).catch(() => {});
        await audit({ actorType: "system", action: "user.final_warning", targetType: "user", targetId: String(u.user_id), metadata: { daysInactive } });
        finalWarned += 1;
      }
    } else if (daysInactive >= p.inactiveDays) {
      if (!data?.dryRun) {
        if (emailAddr) await email.inactiveWarning(emailAddr, { name: emailAddr.split("@")[0] ?? "there", days: String(daysInactive) }).catch(() => {});
        await audit({ actorType: "system", action: "user.inactive_warning", targetType: "user", targetId: String(u.user_id), metadata: { daysInactive } });
        warned += 1;
      }
    }
  }

  return `Inactivity policy scanned users: ${warned} warned, ${finalWarned} final warnings, ${scheduled} scheduled for deletion (${data?.dryRun ? "dry run" : "live"}).`;
}
