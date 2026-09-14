// Inactivity policy.
// Configurable workflow: warning → final warning → grace period → deletion.
// Backend-enforced; never triggered by the client. Email notifications are sent
// at each stage, and all automated actions are audited.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { email } from "@/lib/email";
import { audit } from "@/lib/api/audit";
import { notify } from "@/lib/notifications";
import { getSettings } from "@/lib/settings/system";

export interface InactivityPolicy {
  inactiveDays: number;
  warningDays: number;
  finalWarningDays: number;
  graceDays: number;
}

/**
 * The inactivity thresholds, from system_settings.
 *
 * These were environment variables read through process.env, which on Workers does
 * not see the binding — so this always returned its hardcoded defaults, and the
 * documented INACTIVITY_* variables did nothing at all.
 *
 * The stored values are also far more cautious than those defaults were: a year of
 * inactivity before the first warning rather than 90 days. This job ends in
 * deleting somebody's account, and where the two sources disagreed the careful one
 * is the one worth keeping.
 */
export async function policy(): Promise<InactivityPolicy> {
  const s = await getSettings();
  return {
    inactiveDays: s.inactivity_warn_days,
    warningDays: s.inactivity_warn_days,
    finalWarningDays: s.inactivity_final_warn_days,
    graceDays: s.inactivity_grace_days,
  };
}

export async function runInactivityPolicy(data?: { dryRun?: boolean }): Promise<string> {
  const p = await policy();
  const admin = createAdminClient();
  const cutoff = Date.now() - p.inactiveDays * 86400000;

  const { data: users, error } = await admin
    .from("user_storage")
    .select("user_id, plan_id, status, last_login_at, created_at, inactivity_stage")
    .eq("status", "active");
  if (error) return `Inactivity policy failed: ${error.message}`;

  let warned = 0, finalWarned = 0, scheduled = 0;

  for (const u of (users ?? [])) {
    const lastActivity = u.last_login_at ? new Date(u.last_login_at).getTime() : new Date(u.created_at).getTime();
    const daysInactive = Math.floor((Date.now() - lastActivity) / 86400000);

    if (daysInactive < p.inactiveDays) continue;

    // What this account has already been sent. The job runs daily; without this, every
    // day inside a window re-sent that window's email (migration 0024).
    const stage = u.inactivity_stage as "warned" | "final_warned" | null;
    const userId = String(u.user_id);

    const lookupEmail = async () => (await admin.auth.admin.getUserById(userId)).data?.user?.email;
    const setStage = (next: "warned" | "final_warned") =>
      admin.from("user_storage").update({ inactivity_stage: next }).eq("user_id", userId);

    if (daysInactive >= p.inactiveDays + p.warningDays + p.finalWarningDays + p.graceDays) {
      // Beyond grace → mark pending deletion (deletion itself is a separate, explicit step).
      // Happens once by construction: the status change takes the account out of this query.
      if (!data?.dryRun) {
        await admin.from("user_storage").update({ status: "pending_deletion" }).eq("user_id", userId);
        const emailAddr = await lookupEmail();
        if (emailAddr) await email.inactiveFinal(emailAddr, { name: emailAddr.split("@")[0] ?? "there", grace: String(p.graceDays) }).catch(() => {});
        await audit({ actorType: "system", action: "user.schedule_deletion", targetType: "user", targetId: userId, metadata: { daysInactive } });
        scheduled += 1;
      }
    } else if (daysInactive >= p.inactiveDays + p.warningDays + p.finalWarningDays) {
      if (stage === "final_warned") continue;
      if (!data?.dryRun) {
        const emailAddr = await lookupEmail();
        if (emailAddr) await email.inactiveFinal(emailAddr, { name: emailAddr.split("@")[0] ?? "there", grace: String(p.graceDays) }).catch(() => {});
        await notify({
          userId,
          type: "inactivity_final",
          title: "Final notice: this account is inactive",
          body: `It will be scheduled for deletion after a ${p.graceDays}-day grace period. Signing in cancels that — nothing else is needed.`,
          link: "/app",
        });
        await setStage("final_warned");
        await audit({ actorType: "system", action: "user.final_warning", targetType: "user", targetId: userId, metadata: { daysInactive } });
      }
      finalWarned += 1;
    } else if (daysInactive >= p.inactiveDays) {
      if (stage) continue;
      if (!data?.dryRun) {
        const emailAddr = await lookupEmail();
        if (emailAddr) await email.inactiveWarning(emailAddr, { name: emailAddr.split("@")[0] ?? "there", days: String(daysInactive) }).catch(() => {});
        await notify({
          userId,
          type: "inactivity_warning",
          title: `This account has been inactive for ${daysInactive} days`,
          body: "Signing in now and then keeps it active. Nothing else is needed.",
          link: "/app",
        });
        await setStage("warned");
        await audit({ actorType: "system", action: "user.inactive_warning", targetType: "user", targetId: userId, metadata: { daysInactive } });
      }
      warned += 1;
    }
  }

  return `Inactivity policy scanned users: ${warned} warned, ${finalWarned} final warnings, ${scheduled} scheduled for deletion (${data?.dryRun ? "dry run" : "live"}).`;
}
