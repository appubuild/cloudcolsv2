// Type-safe config read from environment variables.
//
// Every value is a getter, deliberately.
//
// This used to be a plain object literal, which read process.env once when the
// module was first evaluated. That works under Node, where the environment exists
// before any code runs. On Cloudflare Workers it does not: the runtime bindings
// are handed to the Worker per request, and OpenNext copies them into process.env
// at the start of each one — after modules have already been evaluated. So every
// value froze as "" and stayed that way, and a deployment with every variable
// correctly set reported that nothing was configured.
//
// It was invisible locally because `wrangler dev` loads .dev.vars into the process
// before the Worker starts, so the snapshot happened to be populated. Reading at
// access time behaves the same in both.
//
// NEXT_PUBLIC_* values are written as static process.env.X references so Next can
// still inline them into the browser bundle; the getter only defers *when* the
// (possibly inlined) value is read.

function first(...values: (string | undefined)[]): string {
  for (const v of values) {
    if (v) return v;
  }
  return "";
}

/**
 * Reads a variable through a dynamic lookup, on the server only.
 *
 * Next replaces every `process.env.NEXT_PUBLIC_X` in the source — server code
 * included — with the value present at build time, and the docs are explicit that
 * the app "will no longer respond to changes to these environment variables"
 * afterwards. So a NEXT_PUBLIC_ value added as a runtime variable is never read:
 * the expression that would have read it no longer exists.
 *
 * Bracket access through a variable is not inlined, which leaves the real runtime
 * value reachable. Guarded to the server because in the browser there is no real
 * process.env behind the substitutions.
 */
function runtime(name: string): string | undefined {
  if (typeof window !== "undefined") return undefined;
  return process.env[name];
}

export const env = {
  // Data layer selection. The client (repository facade) can only read NEXT_PUBLIC_*
  // vars, so the client-facing switch MUST be NEXT_PUBLIC_DATA_LAYER (inlined by
  // Next at build). DATA_LAYER is the server-side alias.
  get dataLayer(): string {
    return (
      first(
        process.env.NEXT_PUBLIC_DATA_LAYER,
        runtime("NEXT_PUBLIC_DATA_LAYER"),
        process.env.DATA_LAYER,
      ) || "mock"
    );
  },

  // SUPABASE_URL is accepted as a fallback so the server still works when only the
  // non-public name was set. The browser can only ever see the NEXT_PUBLIC_ one.
  get supabaseUrl(): string {
    return first(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      runtime("NEXT_PUBLIC_SUPABASE_URL"),
      process.env.SUPABASE_URL,
    );
  },
  get supabaseAnonKey(): string {
    return first(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      runtime("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      process.env.SUPABASE_ANON_KEY,
    );
  },
  get supabaseServiceRoleKey(): string {
    return first(process.env.SUPABASE_SERVICE_ROLE_KEY); // SERVER ONLY
  },

  b2: {
    get endpoint(): string {
      return first(process.env.B2_ENDPOINT);
    },
    get region(): string {
      return first(process.env.B2_REGION) || "us-west-000";
    },
    get bucket(): string {
      return first(process.env.B2_BUCKET);
    },
    get accessKeyId(): string {
      return first(process.env.B2_ACCESS_KEY_ID); // SERVER ONLY
    },
    get secretAccessKey(): string {
      return first(process.env.B2_SECRET_ACCESS_KEY); // SERVER ONLY
    },
    get publicDomain(): string {
      return first(process.env.B2_PUBLIC_DOMAIN); // CDN/custom domain for delivery
    },
  },

  cloudflare: {
    get workerUrl(): string {
      return first(process.env.CLOUDFLARE_WORKER_URL);
    },
    get cdnDomain(): string {
      return first(process.env.CDN_DOMAIN); // signed-delivery worker URL
    },
    get cdnTicketSecret(): string {
      return first(process.env.CDN_TICKET_SECRET); // SERVER ONLY
    },
  },

  email: {
    get provider(): string {
      return first(process.env.EMAIL_PROVIDER) || "console"; // console | resend | smtp | custom
    },
    get from(): string {
      return first(process.env.EMAIL_FROM);
    },
    get appUrl(): string {
      return (
        first(process.env.NEXT_PUBLIC_APP_URL, runtime("NEXT_PUBLIC_APP_URL")) ||
        "http://localhost:3000"
      );
    },
  },

  jobs: {
    get token(): string {
      return first(process.env.JOBS_TOKEN); // SERVER ONLY
    },
  },

  API_BASE_URL_INTERNAL: "/api", // same-origin route handlers
} as const;

// There is deliberately no module-level `isApiLayer` constant here. On the server
// it would be captured before the runtime environment exists — the exact bug this
// file's getters were written to avoid. Read `env.dataLayer` where it is needed.
// The client's own switch lives in lib/repositories/index.ts, where a build-time
// value is what is wanted.
