import { limited, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { email } from "@/lib/email";

export const dynamic = "force-dynamic";

interface Body {
  email: string;
}

// Generate + send an email verification link via Supabase admin.
export const POST = limited(async (req: Request) => {
  const body = (await req.json()) as Body;
  if (!body.email?.trim()) throw new ApiError("INVALID_INPUT", 400, "Email is required.");

  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // Magic-link flow lets the user confirm ownership of the email without a
  // pre-existing password (works whether or not email confirmation is on).
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: body.email.trim(),
    options: { redirectTo: `${appUrl}/login` },
  });
  if (error || !data?.properties?.action_link) {
    throw new ApiError("VERIFY_FAILED", 400, "Could not generate verification link.");
  }

  email.verify(body.email.trim(), {
    name: body.email.split("@")[0] ?? "there",
    link: data.properties.action_link,
  }).catch(() => {});
  return { ok: true, sent: true };
}, DEFAULT_LIMITS.reset);
