// System settings: the business rules an admin changes without a deploy.
//
// These lived in environment variables — TRASH_RETENTION_DAYS, INACTIVITY_DAYS and
// friends — which means changing one is a deploy, and reading one on Workers is
// unreliable anyway (process.env does not see bindings). Worse, several existed
// only as a default in the one function that used them, so there was nothing an
// admin could have edited even in principle.
//
// The `system_settings` table already existed with exactly the right shape:
// key, jsonb value, description, and is_public to separate what a browser may see
// from what only the server may. This reads and writes that.
//
// Every key is declared below with a type, a default and a validator. A key that is
// not declared cannot be written, so a typo in an admin request cannot quietly
// create `trash_retention_dayz` and leave the real setting untouched.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/api/auth";

const CACHE_TTL_MS = 30_000;

export type SettingValue = number | boolean | string | string[] | Record<string, unknown>;

interface Definition<T extends SettingValue> {
  /** Used when the row is missing or holds something invalid. */
  fallback: T;
  /** Whether a browser may read it. Never make a key public that shapes a security decision. */
  isPublic: boolean;
  description: string;
  /** Returns the coerced value, or null to reject. */
  parse: (raw: unknown) => T | null;
}

/**
 * A whole number in range, and genuinely a number.
 *
 * `Number(raw)` was too generous: the string "30" became 30, and so would "3e9".
 * A JSON body sending a string where a number belongs is a caller bug, and coercing
 * it means the one case that matters — something unparseable arriving as `null` or
 * `""`, both of which `Number()` turns into 0 — lands inside the range for any
 * setting whose minimum is 0.
 */
const int = (min: number, max: number) => (raw: unknown): number | null => {
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < min || raw > max) return null;
  return raw;
};

const bool = (raw: unknown): boolean | null => (typeof raw === "boolean" ? raw : null);

const stringList = (raw: unknown): string[] | null =>
  Array.isArray(raw) && raw.every((v) => typeof v === "string") ? (raw as string[]) : null;

const GIB = 1024 * 1024 * 1024;

/**
 * The settings that exist. Adding one here is what makes it writable.
 *
 * The inactivity defaults are the values already in the table (a year before the
 * first warning), not the 90 days that were hardcoded in lib/jobs/inactivity.ts.
 * Deleting somebody's account is the most destructive thing this product does, and
 * where two sources disagreed the more cautious one is the one to keep.
 */
export const SETTINGS = {
  ads_enabled: {
    fallback: true,
    isPublic: true,
    description: "Master switch for ads on ad-supported plans",
    parse: bool,
  } as Definition<boolean>,

  ads_config: {
    fallback: { providerId: "", placements: {} as Record<string, boolean> },
    isPublic: true,
    description: "Ad provider id and which placements are enabled",
    parse: (raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const o = raw as Record<string, unknown>;
      const providerId = typeof o.providerId === "string" ? o.providerId.slice(0, 120) : "";
      const placementsRaw = o.placements;
      if (placementsRaw !== undefined && (typeof placementsRaw !== "object" || placementsRaw === null || Array.isArray(placementsRaw))) {
        return null;
      }
      const placements: Record<string, boolean> = {};
      for (const [k, v] of Object.entries((placementsRaw as Record<string, unknown>) ?? {})) {
        if (typeof v !== "boolean") return null;
        placements[k.slice(0, 60)] = v;
      }
      return { providerId, placements };
    },
  } as Definition<{ providerId: string; placements: Record<string, boolean> }>,

  maintenance_mode: {
    fallback: false,
    isPublic: true,
    description: "When true, non-admin write operations are rejected",
    parse: bool,
  } as Definition<boolean>,

  registration_enabled: {
    fallback: true,
    isPublic: true,
    description: "Allow new account registration",
    parse: bool,
  } as Definition<boolean>,

  max_file_size_bytes: {
    fallback: 3 * GIB,
    isPublic: true,
    description: "Hard ceiling on a single upload, across every plan",
    parse: int(1024 * 1024, 10 * GIB),
  } as Definition<number>,

  trash_retention_days: {
    fallback: 30,
    isPublic: true,
    description: "Days a file stays in trash before permanent deletion",
    parse: int(1, 3650),
  } as Definition<number>,

  abandoned_upload_hours: {
    fallback: 24,
    isPublic: false,
    description: "Hours before an unfinished upload is swept away, rows and parts alike",
    // Long enough that a genuinely slow upload is never mistaken for an abandoned
    // one: a 3 GB file on a poor connection can legitimately take many hours.
    parse: int(2, 720),
  } as Definition<number>,

  trash_counts_toward_quota: {
    fallback: true,
    isPublic: true,
    description: "Whether trashed files consume storage quota",
    parse: bool,
  } as Definition<boolean>,

  inactivity_warn_days: {
    fallback: 365,
    isPublic: false,
    description: "Days of inactivity before the first warning",
    parse: int(1, 3650),
  } as Definition<number>,

  inactivity_final_warn_days: {
    fallback: 395,
    isPublic: false,
    description: "Days of inactivity before the final warning",
    parse: int(1, 3650),
  } as Definition<number>,

  inactivity_grace_days: {
    fallback: 425,
    isPublic: false,
    description: "Days of inactivity before the account is scheduled for deletion",
    parse: int(1, 3650),
  } as Definition<number>,

  allowed_upload_mime_deny: {
    fallback: ["application/x-msdownload", "application/x-msdos-program", "application/x-sh"],
    isPublic: false,
    description: "MIME types rejected at upload, on top of the built-in allow-list",
    parse: stringList,
  } as Definition<string[]>,

  signed_url_ttl_seconds: {
    fallback: 900,
    isPublic: false,
    description: "Lifetime of presigned download and preview URLs",
    parse: int(60, 86400),
  } as Definition<number>,

  upload_url_ttl_seconds: {
    fallback: 3600,
    isPublic: false,
    description: "Lifetime of presigned upload URLs",
    parse: int(60, 86400),
  } as Definition<number>,
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingsMap = { [K in SettingKey]: (typeof SETTINGS)[K] extends Definition<infer T> ? T : never };

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

let cache: { at: number; values: SettingsMap } | null = null;

/**
 * Every setting, with defaults filled in.
 *
 * A row that is missing, or holds something the validator rejects, falls back to
 * the declared default rather than throwing. A bad value in one row should not take
 * down uploads; it should behave as though nobody had configured it.
 */
export async function getSettings(): Promise<SettingsMap> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.values;

  const values = Object.fromEntries(
    Object.entries(SETTINGS).map(([key, def]) => [key, (def as Definition<SettingValue>).fallback]),
  ) as SettingsMap;

  try {
    const admin = createAdminClient();
    const { data } = await admin.from("system_settings").select("key, value");
    for (const row of data ?? []) {
      const key = String(row.key);
      if (!isSettingKey(key)) continue;
      const parsed = (SETTINGS[key] as Definition<SettingValue>).parse(row.value);
      if (parsed !== null) (values as Record<string, SettingValue>)[key] = parsed;
    }
  } catch {
    // Unreachable database: run on defaults rather than failing every request that
    // needs a setting. The defaults are the conservative values.
  }

  cache = { at: Date.now(), values };
  return values;
}

/** One setting. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingsMap[K]> {
  return (await getSettings())[key];
}

/** Only the keys a browser may read. */
export async function getPublicSettings(): Promise<Partial<SettingsMap>> {
  const all = await getSettings();
  const out: Record<string, SettingValue> = {};
  for (const [key, def] of Object.entries(SETTINGS)) {
    if ((def as Definition<SettingValue>).isPublic) out[key] = (all as Record<string, SettingValue>)[key];
  }
  return out as Partial<SettingsMap>;
}

/**
 * Write one setting. Rejects an unknown key and a value the validator refuses,
 * so a malformed admin request cannot store something every reader will then
 * silently fall back from.
 *
 * `authUserId` is the auth.users id of the staff member, not their `admins` row id.
 * The column has a foreign key to auth.users, and passing the admins id makes every
 * write fail on the constraint. These are different uuids and nothing but the
 * database catches the difference — the same trap lib/api/adminAuth.ts documents.
 * It is nullable because an admin row need not be linked to an auth account; who
 * made the change is recorded properly in audit_logs either way.
 */
export async function setSetting(key: string, value: unknown, authUserId: string | null): Promise<SettingValue> {
  if (!isSettingKey(key)) throw new ApiError("UNKNOWN_SETTING", 400, `"${key}" is not a setting.`);

  const def = SETTINGS[key] as Definition<SettingValue>;
  const parsed = def.parse(value);
  if (parsed === null) throw new ApiError("INVALID_SETTING", 400, `That is not a valid value for "${key}".`);

  const admin = createAdminClient();
  const { error } = await admin.from("system_settings").upsert(
    {
      key,
      value: parsed,
      description: def.description,
      is_public: def.isPublic,
      updated_at: new Date().toISOString(),
      updated_by: authUserId,
    },
    { onConflict: "key" },
  );
  if (error) throw new ApiError("UPDATE_FAILED", 400, error.message);

  bustSettingsCache();
  return parsed;
}

export function bustSettingsCache(): void {
  cache = null;
}
