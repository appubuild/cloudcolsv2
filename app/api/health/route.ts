import { serverEnv, serverConfig, configSource } from "@/lib/config/server-env";

export const dynamic = "force-dynamic";

export async function GET() {
  // The browser and the server pick their data layer from different variables,
  // and they can disagree. NEXT_PUBLIC_DATA_LAYER is baked into the bundle at
  // build time and is the only one the browser can read; DATA_LAYER is read from
  // the environment at request time and is the only one the server sees.
  //
  // Set only DATA_LAYER and the result is a deployment that reports "api" while
  // every page in the browser quietly serves fabricated data: sign-in appears to
  // work, uploads appear to succeed, files appear in the list — and the database
  // stays empty. Both are reported so one request tells you which.
  // The client value must come from the static reference: that is the one Next
  // inlined into the browser bundle, and therefore the one the browser will use.
  const client = process.env.NEXT_PUBLIC_DATA_LAYER ?? null;
  // The server value comes from the Worker's own bindings.
  const server = serverConfig("DATA_LAYER", "NEXT_PUBLIC_DATA_LAYER") || null;
  const effectiveClient = client ?? "mock";
  const effectiveServer = server ?? client ?? "mock";

  const supabaseConfigured = Boolean(serverEnv.supabaseUrl && serverEnv.supabaseServiceRoleKey);
  const b2Configured = Boolean(
    serverEnv.b2.endpoint && serverEnv.b2.bucket && serverEnv.b2.accessKeyId && serverEnv.b2.secretAccessKey,
  );

  // Name what is actually missing. "supabase: false" sends someone back to a
  // dashboard with ten variables in it and no way to tell which one is wrong.
  const missing = (
    [
      ["SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)", serverEnv.supabaseUrl],
      ["SUPABASE_SERVICE_ROLE_KEY", serverEnv.supabaseServiceRoleKey],
      ["B2_ENDPOINT", serverEnv.b2.endpoint],
      ["B2_BUCKET", serverEnv.b2.bucket],
      ["B2_ACCESS_KEY_ID", serverEnv.b2.accessKeyId],
      ["B2_SECRET_ACCESS_KEY", serverEnv.b2.secretAccessKey],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  const warnings: string[] = [];
  if (effectiveClient !== effectiveServer) {
    warnings.push(
      `The browser will use "${effectiveClient}" while the server uses "${effectiveServer}". ` +
        "Set NEXT_PUBLIC_DATA_LAYER as a BUILD variable (it is inlined into the bundle) " +
        "and DATA_LAYER as a runtime variable, to the same value.",
    );
  }
  if (effectiveClient === "mock") {
    warnings.push("The browser is serving mock data. Nothing it shows is stored anywhere.");
  }
  if (missing.length) {
    warnings.push(
      `Missing on the server: ${missing.join(", ")}. Add them as RUNTIME variables ` +
        "(Settings -> Variables and secrets), not build variables.",
    );
  }
  if (!b2Configured) {
    warnings.push("Backblaze is not configured; uploads and downloads will fail.");
  }
  if (!supabaseConfigured) {
    warnings.push("Supabase is not configured; sign-in and every data request will fail.");
  }

  return Response.json({
    ok: warnings.length === 0,
    service: "cloudcols-api",
    // So it is always possible to tell which build answered. Without it, a fix that
    // has not finished deploying is indistinguishable from a fix that did not work.
    build: process.env.CF_VERSION_METADATA_ID ?? process.env.WORKERS_CI_COMMIT_SHA ?? "unknown",
    dataLayer: { client: effectiveClient, server: effectiveServer },
    providers: { supabase: supabaseConfigured, b2: b2Configured },
    // Whether each value came from the Worker's bindings or from process.env.
    // "missing" against a name the dashboard clearly shows means the name differs
    // from what the code reads — a typo, or the wrong one of the two settings pages.
    sources: {
      SUPABASE_URL: configSource("SUPABASE_URL"),
      NEXT_PUBLIC_SUPABASE_URL: configSource("NEXT_PUBLIC_SUPABASE_URL"),
      SUPABASE_SERVICE_ROLE_KEY: configSource("SUPABASE_SERVICE_ROLE_KEY"),
      B2_ENDPOINT: configSource("B2_ENDPOINT"),
      B2_BUCKET: configSource("B2_BUCKET"),
      B2_ACCESS_KEY_ID: configSource("B2_ACCESS_KEY_ID"),
      B2_SECRET_ACCESS_KEY: configSource("B2_SECRET_ACCESS_KEY"),
    },
    ...(missing.length ? { missingAtRuntime: missing } : {}),
    ...(warnings.length ? { warnings } : {}),
    time: new Date().toISOString(),
  });
}
