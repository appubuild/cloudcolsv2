import { env } from "@/lib/config/env";

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
  const client = process.env.NEXT_PUBLIC_DATA_LAYER ?? null;
  const server = process.env.DATA_LAYER ?? null;
  const effectiveClient = client ?? "mock";
  const effectiveServer = server ?? client ?? "mock";

  const supabaseConfigured = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
  const b2Configured = Boolean(env.b2.endpoint && env.b2.bucket && env.b2.accessKeyId && env.b2.secretAccessKey);

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
  if (!supabaseConfigured) {
    warnings.push(
      "Supabase is not configured at runtime. SUPABASE_SERVICE_ROLE_KEY is a runtime secret; " +
        "setting it as a build variable leaves the server without it.",
    );
  }
  if (!b2Configured) {
    warnings.push("Backblaze is not configured at runtime; uploads and downloads will fail.");
  }

  return Response.json({
    ok: warnings.length === 0,
    service: "cloudcols-api",
    dataLayer: { client: effectiveClient, server: effectiveServer },
    providers: { supabase: supabaseConfigured, b2: b2Configured },
    ...(warnings.length ? { warnings } : {}),
    time: new Date().toISOString(),
  });
}
