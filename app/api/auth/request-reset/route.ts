import "server-only";
import { limited, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { email } from "@/lib/email";
import { appOrigin } from "@/lib/api/session";

export const dynamic = "force-dynamic";

interface Body {
  email: string;
}

/**
 * Sends a password-reset link. Never says whether the address has an account.
 *
 * The flow this replaces could not work end to end. The form never called it — it
 * showed "reset link sent" and did nothing. Had it been called, Supabase would have
 * sent one email and this route a second, whose link carried no token at all; both
 * pointed at /reset-password, which did not exist.
 *
 * Now: a single-use recovery token from Supabase, in a link to our own page, sent
 * through our own email provider. The page exchanges the token server-side
 * (/api/auth/reset-password), so no session ever touches the browser's script.
 */
export const POST = limited(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as Body;
  const address = String(body.email ?? "").trim().toLowerCase();
  if (!address) throw new ApiError("INVALID_INPUT", 400, "Email is required.");

  const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "recovery", email: address });

  // An unknown address fails here. The answer is the same either way.
  const hashed = data?.properties?.hashed_token;
  if (!error && hashed) {
    const link = `${appOrigin(req)}/reset-password?token_hash=${encodeURIComponent(hashed)}`;
    await email
      .reset(address, { name: address.split("@")[0] ?? "there", link })
      .catch((e) => console.error("[reset] email failed", (e as Error).message));
  }

  return { ok: true };
}, DEFAULT_LIMITS.reset);
