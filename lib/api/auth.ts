// Server-side auth helpers for API route handlers.
// Verifies the Supabase JWT in the Authorization header and returns the user,
// or throws an UNAUTHORIZED error.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { checkRateLimit, type RateLimitResult } from "./rateLimit";

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

/** Extract and verify an authenticated user from a request. */
export async function requireUser(request: Request): Promise<AuthUser> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new ApiError("UNAUTHORIZED", 401, "Missing authorization token.");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new ApiError("UNAUTHORIZED", 401, "Invalid or expired session.");

  return { id: data.user.id, email: data.user.email ?? "" };
}

/** Wrap a handler so expected errors map to HTTP responses without leaking stack traces. */
export function handler<Arg, Res>(
  fn: (req: Request, ctx?: Arg) => Promise<Res>
): (req: Request, ctx?: Arg) => Promise<Response> {
  return async (req, ctx) => {
    try {
      const data = await fn(req, ctx);
      // API payloads are per-user / per-request; never let a proxy cache them.
      return Response.json({ ok: true, data }, { status: 200, headers: { "cache-control": "no-store" } });
    } catch (e) {
      const err = e as ApiError;
      const status = err.status ?? 500;
      const code = err.code ?? "INTERNAL_ERROR";
      const message = status >= 500 ? "Internal server error." : err.message;
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

/** Best-effort client IP (works behind most reverse proxies + Vercel). */
export function clientIp(req: Request): string {
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
    const rl = checkRateLimit(`${opts.name}:${clientIp(req)}`, opts.limit, windowMs);
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
