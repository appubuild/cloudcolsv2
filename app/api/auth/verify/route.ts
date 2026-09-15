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
 * Emails a one-time sign-in link, which also confirms the address.
 *
 * The link goes to /auth/confirm, which exchanges its token server-side and sets the
 * session cookies. It used to land on /login with the session in the URL fragment,
 * for a browser-side Supabase client to pick up — which no longer exists.
 */
export const POST = limited(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as Body;
  const address = String(body.email ?? "").trim().toLowerCase();
  if (!address) throw new ApiError("INVALID_INPUT", 400, "Email is required.");

  const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email: address });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) throw new ApiError("VERIFY_FAILED", 400, "Could not generate verification link.");

  const link = `${appOrigin(req)}/auth/confirm?type=magiclink&token_hash=${encodeURIComponent(hashed)}`;
  await email
    .verify(address, { name: address.split("@")[0] ?? "there", link })
    .catch((e) => console.error("[verify] email failed", (e as Error).message));
  return { ok: true, sent: true };
}, DEFAULT_LIMITS.reset);
