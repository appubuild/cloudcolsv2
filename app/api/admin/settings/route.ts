import "server-only";
import { handler, ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { audit } from "@/lib/api/audit";
import { SETTINGS, getSettings, setSetting, isSettingKey } from "@/lib/settings/system";

export const dynamic = "force-dynamic";

/**
 * The business rules an admin can change without a deploy.
 *
 * These were environment variables, so changing one meant a redeploy — and on
 * Workers, reading one through process.env does not reliably see the binding
 * anyway. Several had no configured value at all and existed only as a default
 * inside the single function that used them.
 */
export const GET = handler(async (req: Request) => {
  await requireAdmin(req, "support");
  const values = await getSettings();

  // The definitions travel with the values so the admin screen can render a control
  // per setting without a second, drifting copy of what each one means.
  return Object.entries(SETTINGS).map(([key, def]) => ({
    key,
    value: (values as Record<string, unknown>)[key],
    description: def.description,
    isPublic: def.isPublic,
    type: Array.isArray(def.fallback) ? "list" : typeof def.fallback,
  }));
});

interface Body {
  /** One or more settings to write, as { key: value }. */
  settings?: Record<string, unknown>;
}

/**
 * Write settings. super_admin: these decide whether people can register, whether
 * the product is in maintenance, and how long before an inactive account is
 * scheduled for deletion.
 *
 * Each key is validated on its own and applied on its own. A rejected key does not
 * discard the ones that were fine — it comes back in `rejected` so the screen can
 * say which control was refused and why.
 */
export const PATCH = handler(async (req: Request) => {
  const staff = await requireAdmin(req, "super_admin");
  const body = (await req.json()) as Body;

  const entries = Object.entries(body.settings ?? {});
  if (entries.length === 0) throw new ApiError("INVALID_INPUT", 400, "No settings were supplied.");

  const before = await getSettings();
  const applied: Record<string, unknown> = {};
  const rejected: { key: string; reason: string }[] = [];

  for (const [key, value] of entries) {
    if (!isSettingKey(key)) {
      rejected.push({ key, reason: "Unknown setting." });
      continue;
    }
    try {
      // staff.userId, not staff.id: the column references auth.users, and the
      // admins row id is a different uuid that fails the constraint.
      applied[key] = await setSetting(key, value, staff.userId);
    } catch (e) {
      rejected.push({ key, reason: (e as Error).message });
    }
  }

  if (Object.keys(applied).length > 0) {
    await audit({
      actorId: staff.id,
      actorType: "admin",
      action: "settings.update",
      targetType: "system_settings",
      targetId: Object.keys(applied).join(","),
      // Both sides, because "who turned registration off" is the question this
      // trail exists to answer.
      metadata: {
        changed: Object.fromEntries(
          Object.entries(applied).map(([k, v]) => [k, { from: (before as Record<string, unknown>)[k], to: v }]),
        ),
      },
    });
  }

  return { settings: await getSettings(), applied: Object.keys(applied), rejected };
});
