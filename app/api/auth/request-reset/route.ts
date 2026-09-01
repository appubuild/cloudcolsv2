import { limited, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { email } from "@/lib/email";

export const dynamic = "force-dynamic";

interface Body {
  email: string;
}

// Request a password reset. Never reveals whether the email exists.
export const POST = limited(async (req: Request) => {
  const body = (await req.json()) as Body;
  if (!body.email?.trim()) throw new ApiError("INVALID_INPUT", 400, "Email is required.");

  const admin = createAdminClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { error } = await admin.auth.resetPasswordForEmail(body.email.trim(), {
    redirectTo: `${appUrl}/reset-password`,
  });
  if (error) throw new ApiError("RESET_FAILED", 400, error.message);

  // Always respond success to avoid account enumeration.
  email.reset(body.email.trim(), { name: body.email.split("@")[0] ?? "there", link: `${appUrl}/reset-password` }).catch(() => {});
  return { ok: true };
}, DEFAULT_LIMITS.reset);
