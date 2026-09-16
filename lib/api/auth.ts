// Server-side auth helpers for API route handlers.
// Verifies the Supabase JWT in the Authorization header and returns the user,
// or throws an UNAUTHORIZED error.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { checkRateLimit, type RateLimitResult } from "./rateLimit";
import { verifySupabaseJwt } from "./jwt";
import { readSession, isSameOrigin, refreshTokens, sessionCookies, clearedSessionCookies } from "./session";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface AuthUser {
  id: string;
  email: string;
  /** The access token this request was authenticated with. Server-side only; never returned. */
  accessToken: string;
  /** Assurance level: "aal1" is a password alone, "aal2" includes a second factor. */
  aal: string | null;
  /** Whether the account requires a second factor (user_storage.mfa_enabled). */
  mfaEnabled: boolean;
}

export interface RequireUserOptions {
  /**
   * Accept a session that has passed the password but still owes its second factor.
   * Only for the routes that finish or recover a sign-in, and the status check the
   * sign-in page makes; everything else refuses such a session.
   */
  allowMfaPending?: boolean;
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** The `aal` claim of a token Auth has already accepted. Read, not verified — Auth did that. */
function unverifiedAal(token: string): string | null {
  try {
    const payload = token.split(".")[1] ?? "";
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { aal?: unknown };
    return typeof json.aal === "string" ? json.aal : null;
  } catch {
    return null;
  }
}

/**
 * Who a token belongs to, or null if nobody.
 *
 * Checked against the project's published signing key, which needs no network once the
 * key is cached (lib/api/jwt.ts says what that does and does not give up). Only when
 * that cannot decide — keys unreachable, a key it has never seen — is Auth asked. A
 * token that check finds wrong is refused outright; asking Auth as well would only let
 * a forger try twice.
 */
async function identify(admin: ReturnType<typeof createAdminClient>, token: string): Promise<AuthUser | null> {
  const local = await verifySupabaseJwt(token);
  if (local.status === "ok") {
    return { id: local.claims.sub, email: local.claims.email, accessToken: token, aal: local.claims.aal, mfaEnabled: false };
  }
  if (local.status === "invalid") return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "", accessToken: token, aal: unverifiedAal(token), mfaEnabled: false };
}

/**
 * Extract and verify an authenticated user from a request.
 *
 * Also where maintenance mode is enforced, for two reasons. Every user-facing write
 * goes through here, so there is no route to forget; and admin routes do not — they
 * call requireAdmin — so an admin can still reach the switch that turns it off,
 * which is the one thing maintenance mode must never prevent.
 *
 * Reads are left alone. Stopping people from seeing their own files during a
 * migration is not what maintenance is for. The Stripe webhook is unaffected too:
 * it has no user session, and money that arrived still has to be recorded.
 */
export async function requireUser(request: Request, opts: RequireUserOptions = {}): Promise<AuthUser> {
  // A Bearer header (mobile app, scripts) or the httpOnly session cookies (the web app).
  // lib/api/session.ts explains the cookies.
  const session = readSession(request);
  if (!session.source) throw new ApiError("UNAUTHORIZED", 401, "Missing authorization token.");

  // Cookies are sent by the browser whoever asked it to, so a cookie-authenticated
  // write must prove it came from our own pages. Bearer tokens cannot be sent by
  // another site without having been stolen first, so they are not asked.
  if (session.source === "cookie" && !isSameOrigin(request)) {
    throw new ApiError("CSRF_REJECTED", 403, "This request did not come from CloudCols.");
  }

  const admin = createAdminClient();
  let user = session.accessToken ? await identify(admin, session.accessToken) : null;

  // A cookie session whose access token has lapsed — they last an hour — is renewed
  // here, on whichever request notices first, and the new cookies ride back on its
  // response. The page never handles a token and never has to retry.
  if (!user && session.source === "cookie" && session.refreshToken) {
    const fresh = await refreshTokens(session.refreshToken);
    if (fresh) {
      user = await identify(admin, fresh.accessToken);
      if (user) for (const c of sessionCookies(request, fresh)) setResponseHeader(request, "set-cookie", c);
    }
  }

  if (!user) {
    // A dead cookie session is cleared, so the page stops presenting it.
    if (session.source === "cookie") {
      for (const c of clearedSessionCookies(request)) setResponseHeader(request, "set-cookie", c);
    }
    throw new ApiError("UNAUTHORIZED", 401, "Invalid or expired session.");
  }

  // A suspended account is refused everything, read included. Suspension exists for
  // abuse, and letting someone keep reading their files while an investigation runs
  // would make it half a measure.
  //
  // Checked here rather than at sign-in on purpose: the session token stays valid
  // for its lifetime, so a check at sign-in would leave an already-signed-in account
  // working until its token expired — exactly the window suspension needs to close.
  const { data: profile } = await admin
    .from("user_storage")
    .select("status, last_login_at, mfa_enabled")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile && String(profile.status) === "suspended") {
    throw new ApiError(
      "ACCOUNT_SUSPENDED",
      403,
      "This account is suspended. Contact support if you think that is a mistake.",
    );
  }

  // Two-factor. A session proven with a password alone (aal1) can do nothing for an
  // account with 2FA on until the code is given (/api/auth/mfa/verify). Checked here,
  // on the row already read for suspension, so every route is covered and none pays
  // an extra query for it.
  user.mfaEnabled = Boolean(profile?.mfa_enabled);
  if (user.mfaEnabled && user.aal !== "aal2" && !opts.allowMfaPending) {
    throw new ApiError("MFA_REQUIRED", 401, "Enter the code from your authenticator app to finish signing in.");
  }

  // Activity, for the inactivity policy. Recorded here rather than only at sign-in:
  // a session refreshes itself for weeks without anyone typing a password, and an
  // account used every day that way must not look abandoned. At most one write per
  // account per day. Any activity also withdraws an inactivity warning, and brings
  // back an account that inactivity had scheduled for deletion.
  if (profile) {
    const pendingDeletion = String(profile.status) === "pending_deletion";
    const last = profile.last_login_at ? Date.parse(String(profile.last_login_at)) : 0;
    if (pendingDeletion || Date.now() - last > 86_400_000) {
      const { error: touchError } = await admin
        .from("user_storage")
        .update({
          last_login_at: new Date().toISOString(),
          inactivity_stage: null,
          ...(pendingDeletion ? { status: "active" } : {}),
        })
        .eq("user_id", user.id);
      if (touchError) console.error("[auth] could not record activity", touchError.message);
    }
  }

  if (WRITE_METHODS.has(request.method.toUpperCase())) {
    // Imported here rather than at module scope: lib/settings/system imports the
    // ApiError declared above, and a top-level import would close that cycle.
    const { getSetting } = await import("@/lib/settings/system");
    if (await getSetting("maintenance_mode")) {
      throw new ApiError(
        "MAINTENANCE",
        503,
        "CloudCols is in maintenance right now. Your files are safe; changes are paused for a few minutes.",
      );
    }
  }

  return user;
}

/** Wrap a handler so expected errors map to HTTP responses without leaking stack traces. */
/**
 * Headers a route wants on its own response, keyed by the request that asked for them.
 *
 * `handler` builds the Response itself, so a route has no way to reach it. This is the
 * seam. A WeakMap rather than a field on the request because Request is not ours to
 * extend, and entries disappear with the request that owns them.
 *
 * Used for the delivery cookie, which has to ride back on the same response that hands
 * out the signed URL — a separate round trip to fetch it would race the first image.
 */
const extraHeaders = new WeakMap<Request, Headers>();

/** Adds a header to the response this request will produce. */
export function setResponseHeader(req: Request, name: string, value: string): void {
  const existing = extraHeaders.get(req) ?? new Headers();
  existing.append(name, value);
  extraHeaders.set(req, existing);
}

function responseHeaders(req: Request, base: Record<string, string>): Headers {
  const headers = new Headers(base);
  const extra = extraHeaders.get(req);
  if (extra) for (const [k, v] of extra) headers.append(k, v);
  return headers;
}

export function handler<Arg, Res>(
  fn: (req: Request, ctx?: Arg) => Promise<Res>
): (req: Request, ctx?: Arg) => Promise<Response> {
  return async (req, ctx) => {
    try {
      const data = await fn(req, ctx);
      // API payloads are per-user / per-request; never let a proxy cache them.
      return Response.json({ ok: true, data }, { status: 200, headers: responseHeaders(req, { "cache-control": "no-store" }) });
    } catch (e) {
      const err = e as ApiError;
      const status = err.status ?? 500;
      const code = err.code ?? "INTERNAL_ERROR";
      /**
       * An ApiError carries a sentence somebody wrote for whoever receives it. An
       * arbitrary throw carries whatever the runtime or a driver happened to say,
       * which can name tables, columns or internal paths — that is the one worth
       * masking.
       *
       * Splitting on the status alone masked both, so a 503 the code raises on
       * purpose reached the user as "Internal server error": maintenance mode said
       * nothing about maintenance, and a missing JOBS_TOKEN said nothing about the
       * token. The code was still correct in both, but nobody reads codes.
       */
      const deliberate = e instanceof ApiError;
      const message = deliberate || status < 500 ? err.message : "Internal server error.";
      // Never expose stack traces to clients in production.
      if (status >= 500) console.error("[api]", code, err.message);
      // Headers a route set still go out on an error: clearing a dead session's
      // cookies happens exactly when the answer is a 401.
      return Response.json(
        { ok: false, error: { code, message } },
        { status, headers: responseHeaders(req, { "cache-control": "no-store" }) }
      );
    }
  };
}

export function json(code: string, status: number, message: string): never {
  throw new ApiError(code, status, message);
}

/**
 * The caller's IP, for keying rate limits.
 *
 * cf-connecting-ip first, and that order is the point. Cloudflare sets it itself and
 * overwrites whatever the client sent. X-Forwarded-For it only appends to, so its first
 * entry is whatever the client chose to put there — and keying a limit on that let
 * anyone reset their own login limit by sending a new made-up address with each try.
 * The other two remain for running outside Cloudflare (next dev, a local proxy).
 */
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ip = (xff.split(",")[0] ?? "").trim();
  return ip || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Build a rate-limit-aware handler for endpoints that must be throttled
 * (login, signup, download-url, share creation, etc.) by client IP.
 */
export function limited<Arg, Res>(
  fn: (req: Request, ctx?: Arg) => Promise<Res>,
  opts: { name: string; limit: number; windowMs?: number }
): (req: Request, ctx?: Arg) => Promise<Response> {
  return handler(async (req, ctx) => {
    const windowMs = opts.windowMs ?? 60_000;
    const rl = await checkRateLimit(`${opts.name}:${clientIp(req)}`, opts.limit, windowMs);
    if (!rl.allowed) {
      throw new ApiError("RATE_LIMITED", 429, "Too many requests. Please try again shortly.");
    }
    return fn(req, ctx);
  });
}

export function rateLimitHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(rl.remaining),
    "X-RateLimit-Reset": String(rl.resetInSeconds),
  };
}

// Configurable default limits (admin-configurable in production). Not hard-coded
// into business logic — they live here so an admin panel or env can tune them.
export const DEFAULT_LIMITS = {
  login: { name: "login", limit: 10, windowMs: 60_000 },
  signup: { name: "signup", limit: 5, windowMs: 60_000 },
  reset: { name: "reset", limit: 3, windowMs: 60_000 },
  // Using a reset link is separate from asking for one: sharing the budget meant two
  // requests for a link used up the attempts to set the password.
  resetPassword: { name: "resetPassword", limit: 5, windowMs: 60_000 },
  // Every 2FA action checks a 6-digit code; a million possibilities is few enough that
  // the rate of guessing must stay low. Supabase limits verification as well.
  mfa: { name: "mfa", limit: 10, windowMs: 60_000 },
  // Also a password check, so it gets a login-like limit: a stolen session must not be
  // able to guess the password here instead.
  accountDelete: { name: "accountDelete", limit: 5, windowMs: 60_000 },
  shareCreate: { name: "shareCreate", limit: 30, windowMs: 60_000 },
  downloadUrl: { name: "downloadUrl", limit: 60, windowMs: 60_000 },
  uploadTicket: { name: "uploadTicket", limit: 60, windowMs: 60_000 },
  backupJob: { name: "backupJob", limit: 30, windowMs: 60_000 },
  backupItem: { name: "backupItem", limit: 120, windowMs: 60_000 },
} as const;
