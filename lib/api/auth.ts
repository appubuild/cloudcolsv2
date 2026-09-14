// Server-side auth helpers for API route handlers.
// Verifies the Supabase JWT in the Authorization header and returns the user,
// or throws an UNAUTHORIZED error.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { checkRateLimit, type RateLimitResult } from "./rateLimit";
import { verifySupabaseJwt } from "./jwt";

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
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

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
export async function requireUser(request: Request): Promise<AuthUser> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new ApiError("UNAUTHORIZED", 401, "Missing authorization token.");

  const admin = createAdminClient();

  // Checked here against the project's published signing key, which needs no network
  // once the key is cached (lib/api/jwt.ts says what that does and does not give up).
  // Only when this cannot decide — keys unreachable, a key it has never seen — is Auth
  // asked instead. A token this can check and finds wrong is refused outright; asking
  // Auth about it as well would only let a forger try twice.
  let user: AuthUser;
  const local = await verifySupabaseJwt(token);
  if (local.status === "ok") {
    user = { id: local.claims.sub, email: local.claims.email };
  } else if (local.status === "invalid") {
    throw new ApiError("UNAUTHORIZED", 401, "Invalid or expired session.");
  } else {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) throw new ApiError("UNAUTHORIZED", 401, "Invalid or expired session.");
    user = { id: data.user.id, email: data.user.email ?? "" };
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
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile && String(profile.status) === "suspended") {
    throw new ApiError(
      "ACCOUNT_SUSPENDED",
      403,
      "This account is suspended. Contact support if you think that is a mistake.",
    );
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
      return Response.json(
        { ok: false, error: { code, message } },
        { status, headers: { "cache-control": "no-store" } }
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
  shareCreate: { name: "shareCreate", limit: 30, windowMs: 60_000 },
  downloadUrl: { name: "downloadUrl", limit: 60, windowMs: 60_000 },
  uploadTicket: { name: "uploadTicket", limit: 60, windowMs: 60_000 },
  backupJob: { name: "backupJob", limit: 30, windowMs: 60_000 },
  backupItem: { name: "backupItem", limit: 120, windowMs: 60_000 },
} as const;
