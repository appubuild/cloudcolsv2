import { serverEnv, serverConfig, configSource } from "@/lib/config/server-env";
import { cdnConfigured } from "@/lib/services/delivery";
import { emailStatus } from "@/lib/email";

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
  // Reading NEXT_PUBLIC_DATA_LAYER here does NOT tell us what the browser will
  // use. Next may have inlined it at build time, or left it as a lookup that finds
  // the runtime binding — and this endpoint runs on the server either way. It
  // reported "api" while the browser was demonstrably on mock.
  //
  // What is true regardless: mock is opt-in by name now, so the browser uses the
  // real backend unless someone deliberately built it with mock. The banner in the
  // app is the authority on what the browser is actually doing.
  const buildTimeValue = process.env.NEXT_PUBLIC_DATA_LAYER ?? null;
  const server = serverConfig("DATA_LAYER", "NEXT_PUBLIC_DATA_LAYER") || null;
  const effectiveServer = server ?? "api";

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

  // Whether file bytes travel user -> Cloudflare -> B2, or user -> B2 directly.
  // Worth one line here because the difference is invisible from the outside and
  // expensive: without it every download and every thumbnail is billed B2 egress and
  // nothing is ever cached.
  const cdn = cdnConfigured();

  /**
   * Whether a message would actually reach anyone.
   *
   * Without a provider every send is a console line and returns quietly, so password
   * resets, share invitations and inactivity warnings all "succeed" while nothing
   * arrives. That silence is the reason this is reported rather than left to be
   * noticed by a user who never got their reset link.
   */
  const mail = emailStatus();

  /**
   * Background work needs a token to run at all.
   *
   * The cron fires on schedule regardless; without JOBS_TOKEN every job refuses, so
   * trash is never emptied and the inactivity lifecycle never advances — silently,
   * because nobody is watching a scheduled run.
   */
  const jobsToken = Boolean(serverConfig("JOBS_TOKEN"));

  const warnings: string[] = [];
  if (effectiveServer === "mock") {
    warnings.push("The server is set to mock. Nothing it returns is stored anywhere.");
  }
  if (buildTimeValue === "mock") {
    warnings.push("This build was made with NEXT_PUBLIC_DATA_LAYER=mock; the browser will serve demo data.");
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
  if (!mail.deliverable) {
    warnings.push(
      `Email provider is "${mail.provider}", so nothing is actually sent — password ` +
        "resets, invitations and inactivity warnings go to the log. Set EMAIL_PROVIDER " +
        "and RESEND_API_KEY on this Worker.",
    );
  }
  if (!jobsToken) {
    warnings.push("JOBS_TOKEN is not set, so the daily cron runs and every job refuses.");
  }
  if (!cdn) {
    warnings.push(
      "CDN_DOMAIN / CDN_TICKET_SECRET are not both set, so files are served straight " +
        "from Backblaze: every byte is billed egress and nothing is cached. Deploy " +
        "infrastructure/wrangler.jsonc and set both on this Worker.",
    );
  }

  return Response.json({
    ok: warnings.length === 0,
    service: "cloudcols-api",
    // So it is always possible to tell which build answered. Without it, a fix that
    // has not finished deploying is indistinguishable from a fix that did not work.
    build: process.env.CF_VERSION_METADATA_ID ?? process.env.WORKERS_CI_COMMIT_SHA ?? "unknown",
    dataLayer: { server: effectiveServer, builtWith: buildTimeValue },
    providers: { supabase: supabaseConfigured, b2: b2Configured, cdn, email: mail.deliverable, jobs: jobsToken },
    // "cdn" means signed tickets are issued and Cloudflare fronts storage; "b2" means
    // readers are sent straight to Backblaze.
    delivery: cdn ? "cdn" : "b2",
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
      CDN_DOMAIN: configSource("CDN_DOMAIN"),
      CDN_TICKET_SECRET: configSource("CDN_TICKET_SECRET"),
      JOBS_TOKEN: configSource("JOBS_TOKEN"),
      EMAIL_PROVIDER: configSource("EMAIL_PROVIDER"),
      RESEND_API_KEY: configSource("RESEND_API_KEY"),
    },
    ...(missing.length ? { missingAtRuntime: missing } : {}),
    ...(warnings.length ? { warnings } : {}),
    time: new Date().toISOString(),
  });
}
