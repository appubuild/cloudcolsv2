import { env } from "@/lib/config/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseConfigured = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
  const b2Configured = Boolean(env.b2.endpoint && env.b2.bucket && env.b2.accessKeyId && env.b2.secretAccessKey);
  return Response.json({
    ok: true,
    service: "cloudcols-api",
    dataLayer: env.dataLayer,
    providers: { supabase: supabaseConfigured, b2: b2Configured },
    time: new Date().toISOString(),
  });
}
