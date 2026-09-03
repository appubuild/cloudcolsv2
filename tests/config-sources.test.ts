/**
 * Nothing may read Supabase configuration straight from the environment.
 *
 * This is a scan of the source rather than a behaviour test, because the bug it
 * guards against is invisible at runtime until a deployment fails. There were four
 * separate places reading NEXT_PUBLIC_SUPABASE_* directly. Fixing three of them
 * left sign-in broken, and the symptom — "Supabase not configured on this
 * deployment" on a deployment where it plainly was — pointed at configuration
 * rather than at the one file still doing it.
 *
 * The rule:
 *
 *   - Browser code reads publicConfig(), which the server fills from the Worker's
 *     bindings. NEXT_PUBLIC_* is compiled into the bundle at build time, so a
 *     value set on the Worker is invisible to a bundle built without it.
 *   - Server code reads serverEnv, which reads those same bindings.
 *
 * Only the three config modules themselves may touch process.env for these.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..");
const SEARCH_DIRS = ["app", "lib", "components"];

// The modules whose whole job is to read the environment.
const ALLOWED = new Set(
  ["lib/config/env.ts", "lib/config/server-env.ts", "lib/config/public-config.ts"].map((p) =>
    p.split("/").join(sep),
  ),
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SEARCH_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)))
  .map((f) => relative(ROOT, f))
  .filter((f) => !ALLOWED.has(f));

describe("configuration is read from one place", () => {
  it("no file reads NEXT_PUBLIC_SUPABASE_* from process.env", () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(join(ROOT, f), "utf8");
      // The health endpoint names the variable in its report, which is not a read.
      return /process\.env\.NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY)\b/.test(src);
    });

    expect(
      offenders,
      "read them through publicConfig() in the browser, or serverEnv on the server",
    ).toEqual([]);
  });

  it("no file outside the config modules builds a Supabase client from env.supabase*", () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(join(ROOT, f), "utf8");
      return /\benv\.supabase(Url|AnonKey)\b/.test(src);
    });

    expect(offenders, "use publicConfig() or serverEnv instead of the env snapshot").toEqual([]);
  });

  it("the browser never touches the service-role key", () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(join(ROOT, f), "utf8");
      if (!/SUPABASE_SERVICE_ROLE_KEY|supabaseServiceRoleKey/.test(src)) return false;
      // Server-only modules are the point; a "use client" one is the danger.
      return /^["']use client["']/m.test(src);
    });

    expect(offenders, "the service-role key must never reach a client component").toEqual([]);
  });
});
