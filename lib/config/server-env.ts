// Server-side configuration, read from the Worker's own bindings.
//
// process.env is not a reliable source on Cloudflare Workers. Bindings are handed
// to the Worker per request and copied into process.env by the adapter, and
// separately Next replaces every `process.env.NEXT_PUBLIC_X` in the source — server
// code included — with whatever was present at build time, after which the app
// "will no longer respond to changes to these environment variables". Between those
// two behaviours, a variable that is plainly set in the dashboard can be
// unreachable, with nothing to say so.
//
// The Worker's env object is the authoritative source: it is what Cloudflare
// actually handed this request, under exactly the names shown in the dashboard.
// This reads that first and falls back to process.env, so the same code works
// under Node, under `next dev`, and on Workers.

import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/** The Worker's bindings for this request, or null when not running on Workers. */
function bindings(): Record<string, unknown> | null {
  try {
    const ctx = getCloudflareContext();
    return (ctx?.env as Record<string, unknown> | undefined) ?? null;
  } catch {
    // Not a Workers runtime (next dev, vitest), or called outside a request.
    return null;
  }
}

/**
 * Reads the first of `names` that has a value.
 *
 * Several names because the same setting legitimately appears under more than one:
 * the browser needs NEXT_PUBLIC_SUPABASE_URL, and the server is just as happy with
 * SUPABASE_URL — and a deployment should not fail because someone picked the other
 * one.
 */
export function serverConfig(...names: string[]): string {
  const env = bindings();

  if (env) {
    for (const name of names) {
      const value = env[name];
      if (typeof value === "string" && value) return value;
    }
  }

  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }

  return "";
}

/**
 * Where a value would be found. Reported by /api/health so it is never a guess
 * whether the Worker's own bindings are reachable or only process.env is.
 */
export function configSource(name: string): "binding" | "process.env" | "missing" {
  const env = bindings();
  if (env && typeof env[name] === "string" && env[name]) return "binding";
  if (process.env[name]) return "process.env";
  return "missing";
}

export const serverEnv = {
  get supabaseUrl(): string {
    return serverConfig("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey(): string {
    return serverConfig("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey(): string {
    return serverConfig("SUPABASE_SERVICE_ROLE_KEY");
  },
  get dataLayer(): string {
    // Mock has to be asked for by name; see lib/repositories/index.ts.
    return serverConfig("DATA_LAYER", "NEXT_PUBLIC_DATA_LAYER") || "api";
  },
  b2: {
    get endpoint(): string {
      return serverConfig("B2_ENDPOINT");
    },
    get region(): string {
      return serverConfig("B2_REGION") || "us-west-000";
    },
    get bucket(): string {
      return serverConfig("B2_BUCKET");
    },
    get accessKeyId(): string {
      return serverConfig("B2_ACCESS_KEY_ID");
    },
    get secretAccessKey(): string {
      return serverConfig("B2_SECRET_ACCESS_KEY");
    },
    get publicDomain(): string {
      return serverConfig("B2_PUBLIC_DOMAIN");
    },
  },
};
