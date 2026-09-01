// Separated admin authentication + RBAC.
// Admin identity is deliberately independent from end-user sessions: staff sign
// in on /admin/login, get a short-lived HMAC-signed admin JWT, and every admin
// route checks the role against the admins table server-side. UI hiding is
// cosmetic; the real enforcement happens here.

import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { ApiError } from "./auth";

export type AdminRole = "super_admin" | "support" | "operator";

export interface AdminIdentity {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

const ADMIN_COOKIE = "cloudcols.admin.token";

/**
 * The key that signs staff sessions.
 *
 * This used to fall back to a literal string when the variable was unset. That
 * string lives in the repository, so a deployment that forgot the variable was
 * signing admin tokens with a publicly known key: anyone could mint one for any
 * address and only needed to guess an active admin's email to hold super_admin.
 *
 * A missing key is a deployment mistake, not a state to keep running in, so it
 * fails here. Outside production a per-process random key keeps local development
 * working without ever being a value an attacker could know.
 */
const devSecret = crypto.randomUUID();

function tokenSecret(): string {
  const configured = process.env.ADMIN_TOKEN_SECRET;
  if (configured && configured.length >= 32) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new ApiError(
      "NOT_CONFIGURED",
      500,
      "ADMIN_TOKEN_SECRET is not set (or is shorter than 32 characters). Admin sign-in is disabled until it is."
    );
  }
  // Development: random per process, so tokens do not survive a restart and no
  // guessable key exists.
  return devSecret;
}
const TTL_MS = 6 * 60 * 60 * 1000; // 6h staff session

function b64url(b: Buffer): string {
  return b.toString("base64url");
}

/** Issue a signed, compact admin token (header.payload.sig). */
export function issueAdminToken(identity: AdminIdentity): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify({ sub: identity.id, email: identity.email, role: identity.role, exp: Date.now() + TTL_MS })));
  const sig = createHmac("sha256", tokenSecret()).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/** Verify + decode an admin token. Returns identity or null. */
export function verifyAdminToken(token: string): AdminIdentity | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = createHmac("sha256", tokenSecret()).update(`${header}.${payload}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.exp !== "number" || Date.now() > data.exp) return null;
    return { id: String(data.sub), email: String(data.email), name: "", role: data.role as AdminRole };
  } catch {
    return null;
  }
}

/** Verifies an admin token, loads the live role from the admins table, applies RBAC. */
export async function requireAdmin(req: Request, minRole?: AdminRole): Promise<AdminIdentity> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const decoded = token ? verifyAdminToken(token) : null;
  if (!decoded) throw new ApiError("UNAUTHORIZED", 401, "Admin session required.");

  const admin = createAdminClient();
  const { data } = await admin.from("admins").select("id, email, name, role, is_active").eq("email", decoded.email).maybeSingle();
  if (!data || !data.is_active) throw new ApiError("FORBIDDEN", 403, "This admin is inactive.");
  const role = data.role as AdminRole;
  if (minRole && !hasRole(role, minRole)) {
    throw new ApiError("FORBIDDEN", 403, `Requires ${minRole} access.`);
  }
  return { id: String(data.id), email: String(data.email), name: String(data.name ?? ""), role };
}

/** Role hierarchy: super_admin ⊇ support ⊇ operator. */
export function hasRole(actual: AdminRole, required: AdminRole): boolean {
  const rank: Record<AdminRole, number> = { operator: 1, support: 2, super_admin: 3 };
  return rank[actual] >= rank[required];
}

export async function authenticateAdmin(email: string, password: string): Promise<AdminIdentity> {
  const admin = createAdminClient();
  // Verify the email belongs to an active admin row, then verify the password
  // against Supabase Auth (the admin is also a real auth user with its password).
  const { data: row } = await admin.from("admins").select("id, email, name, role, is_active, user_id").eq("email", email.trim().toLowerCase()).maybeSingle();
  if (!row || !row.is_active) throw new ApiError("INVALID_CREDENTIALS", 401, "Invalid admin credentials.");

  const verified = await verifyPassword(email.trim().toLowerCase(), password);
  if (!verified) throw new ApiError("INVALID_CREDENTIALS", 401, "Invalid admin credentials.");

  await admin.from("admins").update({ last_login_at: new Date().toISOString() }).eq("id", row.id);
  return { id: String(row.id), email: String(row.email), name: String(row.name ?? ""), role: row.role as AdminRole };
}

/** Verify a password against Supabase Auth's token endpoint. */
async function verifyPassword(email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anon },
    body: JSON.stringify({ email, password }),
  });
  return res.ok;
}

export { ADMIN_COOKIE };
export const adminCookieName = ADMIN_COOKIE;
