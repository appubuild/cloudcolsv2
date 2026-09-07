import "server-only";
import { handler, ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * Everything about one account, for support and abuse investigation.
 *
 * Counts and totals are computed from the rows rather than read from a cached
 * figure, because the figure is what an admin would be checking. Storage is asked
 * of the files themselves for the same reason: if user_storage has drifted from
 * reality, this is the screen that should show it rather than repeat it.
 *
 * The email is only shown to super_admin. Support sees enough to do support.
 */
export const GET = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const admin = await requireAdmin(req, "support");
  const { id } = (await ctx?.params) ?? { id: "" };
  const client = createAdminClient();

  const { data: profile } = await client
    .from("user_storage")
    .select("*")
    .eq("user_id", id)
    .maybeSingle();
  if (!profile) throw new ApiError("USER_NOT_FOUND", 404, "No such account.");

  const [authUser, files, folders, subscription, payments] = await Promise.all([
    client.auth.admin.getUserById(id),
    client.from("files").select("category, size_bytes, status, trashed_at").eq("owner_id", id),
    client.from("folders").select("id", { count: "exact", head: true }).eq("owner_id", id).is("trashed_at", null),
    client
      .from("subscriptions")
      .select("*")
      .eq("user_id", id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("payments")
      .select("id, amount_cents, currency, status, provider, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const rows = files.data ?? [];
  const live = rows.filter((f) => !f.trashed_at && f.status === "ready");

  // Per category, from the files themselves.
  const byCategory = new Map<string, { bytes: number; count: number }>();
  for (const f of live) {
    const key = String(f.category ?? "other");
    const cur = byCategory.get(key) ?? { bytes: 0, count: 0 };
    cur.bytes += Number(f.size_bytes ?? 0);
    cur.count += 1;
    byCategory.set(key, cur);
  }

  const computedUsed = live.reduce((sum, f) => sum + Number(f.size_bytes ?? 0), 0);
  const recordedUsed = Number(profile.storage_used_bytes ?? 0);

  const email = authUser.data?.user?.email ?? "";

  return {
    id,
    // Support can act on an account without needing to read the address.
    email: admin.role === "super_admin" ? email : email ? `${email.slice(0, 2)}•••@•••` : "",
    status: String(profile.status ?? "active"),
    planId: String(profile.plan_id ?? "plan_free"),
    developerEnabled: Boolean(profile.developer_enabled),
    displayName: profile.display_name ? String(profile.display_name) : null,
    createdAt: profile.created_at ? String(profile.created_at) : null,
    lastLoginAt: profile.last_login_at ? String(profile.last_login_at) : null,

    // Collected by the post-registration setup flow (migration 0014). An account
    // that has not finished setup is a normal state, not an error — the screen
    // needs to be able to tell the two apart, so setupCompletedAt is reported
    // rather than inferred from whether the fields happen to be filled.
    contact: {
      countryCode: profile.country_code ? String(profile.country_code) : null,
      phoneCountryCode: profile.phone_country_code ? String(profile.phone_country_code) : null,
      phoneNumber: profile.phone_number ? String(profile.phone_number) : null,
      address: profile.address ? String(profile.address) : null,
      setupCompletedAt: profile.setup_completed_at ? String(profile.setup_completed_at) : null,
    },

    storage: {
      quotaBytes: Number(profile.storage_quota_bytes ?? 0),
      usedBytes: recordedUsed,
      // The two should agree. When they do not, the trigger has missed something
      // and this is the screen where that should be visible.
      computedBytes: computedUsed,
      drifts: computedUsed !== recordedUsed,
      fileCount: live.length,
      trashedCount: rows.filter((f) => f.trashed_at).length,
      folderCount: folders.count ?? 0,
      byCategory: [...byCategory.entries()]
        .map(([category, v]) => ({ category, ...v }))
        .sort((a, b) => b.bytes - a.bytes),
    },

    subscription: subscription.data
      ? {
          id: String(subscription.data.id),
          planId: String(subscription.data.plan_id),
          status: String(subscription.data.status),
          provider: subscription.data.provider ? String(subscription.data.provider) : null,
          startedAt: subscription.data.started_at ? String(subscription.data.started_at) : null,
          renewsAt: subscription.data.renews_at ? String(subscription.data.renews_at) : null,
          cancelledAt: subscription.data.cancelled_at ? String(subscription.data.cancelled_at) : null,
        }
      : null,

    payments: (payments.data ?? []).map((p) => ({
      id: String(p.id),
      amountCents: Number(p.amount_cents),
      currency: String(p.currency),
      status: String(p.status),
      provider: p.provider ? String(p.provider) : null,
      createdAt: String(p.created_at),
    })),
  };
});

interface PatchBody {
  action: "suspend" | "restore";
  reason?: string;
}

/**
 * Suspend an account, or restore it.
 *
 * The Users screen has had a Suspend button since the beginning. It prompted for a
 * reason, then called `authRepo.updateProfile(id, { status: "suspended" })` — the
 * *end user's* profile repository, which PATCHes /api/profile with whatever session
 * the browser holds and accepts only a name and an avatar. So it changed nothing,
 * ignored the id it was given, discarded the reason, showed "User suspended" and
 * reloaded the page. Nobody was ever suspended.
 *
 * Suspension has to mean something on the server, so `requireUser` refuses a
 * suspended account. Sign-in still works — the person can see that their account is
 * suspended rather than being told their password is wrong — but nothing they do
 * reaches their files.
 *
 * A reason is required and recorded. super_admin: this takes someone's account away.
 */
export const PATCH = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const staff = await requireAdmin(req, "super_admin");
  const { id } = (await ctx?.params) ?? { id: "" };
  const body = (await req.json()) as PatchBody;

  if (body.action !== "suspend" && body.action !== "restore") {
    throw new ApiError("INVALID_INPUT", 400, 'action must be "suspend" or "restore".');
  }
  const reason = String(body.reason ?? "").trim();
  if (!reason || reason.length < 3) {
    throw new ApiError("REASON_REQUIRED", 400, "A reason is required, and is written to the audit log.");
  }

  const client = createAdminClient();
  const { data: existing } = await client
    .from("user_storage")
    .select("user_id, status")
    .eq("user_id", id)
    .maybeSingle();
  if (!existing) throw new ApiError("USER_NOT_FOUND", 404, "No such account.");

  const suspending = body.action === "suspend";
  const next = suspending ? "suspended" : "active";
  if (String(existing.status) === next) {
    throw new ApiError("NO_CHANGE", 409, `That account is already ${next}.`);
  }

  const { data: updated, error } = await client
    .from("user_storage")
    .update({ status: next })
    .eq("user_id", id)
    .select("user_id, status")
    .single();
  if (error) throw new ApiError("UPDATE_FAILED", 400, error.message);

  await audit({
    actorId: staff.id,
    actorType: "admin",
    action: suspending ? "admin.user_suspended" : "admin.user_restored",
    targetType: "user",
    targetId: id,
    metadata: { reason, from: String(existing.status), to: next, adminEmail: staff.email },
  });

  return { id: String(updated.user_id), status: String(updated.status) };
});
