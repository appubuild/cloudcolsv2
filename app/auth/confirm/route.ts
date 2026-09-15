import "server-only";
import type { EmailOtpType } from "@supabase/supabase-js";
import { isolatedAuthClient, sessionCookies, tokensFrom } from "@/lib/api/session";

export const dynamic = "force-dynamic";

/**
 * Where a one-time email link lands: exchanges its token for a session, sets the
 * session cookies, and sends the browser on into the app.
 *
 * Password recovery is not handled here — it has its own page, because it must end
 * in a new password, not in a signed-in session.
 *
 * Redirects are relative on purpose: they stay on whichever host the link was opened
 * on, and cannot be steered anywhere else.
 */
const SIGN_IN_TYPES = new Set<EmailOtpType>(["magiclink", "signup", "email", "invite"]);

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const type = (url.searchParams.get("type") ?? "") as EmailOtpType;

  if (!tokenHash || !SIGN_IN_TYPES.has(type)) return redirect("/login?error=link");

  const { data, error } = await isolatedAuthClient().auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.session) return redirect("/login?error=link");

  return redirect("/app", sessionCookies(req, tokensFrom(data.session)));
}
