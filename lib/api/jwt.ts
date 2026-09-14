// Verifying a Supabase access token without asking Supabase.
//
// requireUser used to call Supabase Auth over the network for every request, before
// the endpoint did any work of its own. That is a round trip to another continent on
// every click, and under load it is also a point of failure: the authorization probe
// has twice watched one of those calls take 19–20 seconds and come back as a 500 or a
// 401 that had nothing to do with the caller.
//
// This project signs its tokens with an asymmetric key (ES256), and publishes the public
// half at /auth/v1/.well-known/jwks.json. So a token can be checked right here with Web
// Crypto: signature, expiry, issuer and audience, against a key fetched once and cached.
//
// What that gives up, stated plainly: a token stays valid until it expires (an hour)
// even if its session is signed out elsewhere, because nothing asks Auth whether the
// session still exists. Suspension is not affected — requireUser still reads the
// account's status on every request — and neither is anything an admin does to an
// account. It is the trade Supabase itself recommends for server-side verification.

import "server-only";
import { serverEnv } from "@/lib/config/server-env";

export interface VerifiedClaims {
  sub: string;
  email: string;
  exp: number;
  sessionId: string | null;
}

/**
 * What verification concluded.
 *
 *   ok           the token is genuine, current, and meant for this project
 *   invalid      it is not: bad signature, expired, wrong issuer or audience
 *   unavailable  it could not be checked here (no JWKS, a key it does not know, an
 *                algorithm it does not handle) — the caller should fall back to asking
 *                Auth, not refuse
 *
 * The distinction matters. Treating "could not check" as "invalid" would sign
 * everybody out whenever the JWKS endpoint hiccupped; treating it as "valid" would be
 * accepting a token nobody verified.
 */
export type VerifyResult =
  | { status: "ok"; claims: VerifiedClaims }
  | { status: "invalid"; reason: string }
  | { status: "unavailable"; reason: string };

interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
}

/** How long a fetched key set is trusted before it is fetched again. */
const JWKS_TTL_MS = 10 * 60 * 1000;

/** Tolerance for clocks that disagree by a few seconds. */
const CLOCK_SKEW_S = 30;

let cache: { at: number; keys: Map<string, CryptoKey> } | null = null;
let inflight: Promise<Map<string, CryptoKey> | null> | null = null;

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson<T>(segment: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(segment))) as T;
  } catch {
    return null;
  }
}

async function importKey(jwk: Jwk): Promise<CryptoKey | null> {
  try {
    if (jwk.kty === "EC" && jwk.crv === "P-256") {
      return await crypto.subtle.importKey(
        "jwk",
        { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true },
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
    }
    if (jwk.kty === "RSA") {
      return await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e, ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
    }
  } catch {
    // A key that will not import is a key this cannot use; it is skipped, not fatal.
  }
  return null;
}

async function fetchKeys(): Promise<Map<string, CryptoKey> | null> {
  const url = serverEnv.supabaseUrl;
  if (!url) return null;
  try {
    const res = await fetch(`${url}/auth/v1/.well-known/jwks.json`, {
      headers: serverEnv.supabaseAnonKey ? { apikey: serverEnv.supabaseAnonKey } : {},
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid) continue;
      const key = await importKey(jwk);
      if (key) keys.set(jwk.kid, key);
    }
    return keys;
  } catch {
    return null;
  }
}

/**
 * The current key set, fetched at most once at a time.
 *
 * `force` refetches immediately — used when a token names a key the cache does not
 * have, which is exactly what a key rotation looks like from here.
 */
async function keySet(force = false): Promise<Map<string, CryptoKey> | null> {
  if (!force && cache && Date.now() - cache.at < JWKS_TTL_MS) return cache.keys;
  if (!inflight) {
    inflight = fetchKeys().finally(() => {
      inflight = null;
    });
  }
  const keys = await inflight;
  if (keys && keys.size > 0) cache = { at: Date.now(), keys };
  return keys ?? cache?.keys ?? null;
}

export async function verifySupabaseJwt(token: string): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { status: "invalid", reason: "not a JWT" };
  const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];

  const header = decodeJson<{ alg?: string; kid?: string }>(headerSeg);
  if (!header) return { status: "invalid", reason: "unreadable header" };

  // HS256 means a shared secret this code does not hold. Not a reason to refuse — the
  // caller asks Auth instead.
  const alg = header.alg;
  if (alg !== "ES256" && alg !== "RS256") {
    return { status: "unavailable", reason: `algorithm ${alg ?? "none"} is not verified locally` };
  }
  if (!header.kid) return { status: "unavailable", reason: "token names no key" };

  let keys = await keySet();
  if (!keys) return { status: "unavailable", reason: "signing keys could not be fetched" };
  let key = keys.get(header.kid);
  if (!key) {
    keys = await keySet(true);
    key = keys?.get(header.kid);
    if (!key) return { status: "unavailable", reason: "token signed with an unknown key" };
  }

  const signed = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = b64urlToBytes(sigSeg);
  } catch {
    return { status: "invalid", reason: "unreadable signature" };
  }

  const algorithm =
    alg === "ES256"
      ? { name: "ECDSA", hash: "SHA-256" }
      : { name: "RSASSA-PKCS1-v1_5" };
  const genuine = await crypto.subtle.verify(algorithm, key, signature, signed).catch(() => false);
  if (!genuine) return { status: "invalid", reason: "bad signature" };

  const claims = decodeJson<{
    sub?: string;
    email?: string;
    exp?: number;
    iss?: string;
    aud?: string | string[];
    role?: string;
    session_id?: string;
  }>(payloadSeg);
  if (!claims) return { status: "invalid", reason: "unreadable claims" };

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < now) {
    return { status: "invalid", reason: "expired" };
  }

  // Issued by this project's Auth, for signed-in users. A genuine token from another
  // Supabase project, or an anon/service key, must not pass as a user session.
  const expectedIssuer = `${serverEnv.supabaseUrl}/auth/v1`;
  if (claims.iss !== expectedIssuer) return { status: "invalid", reason: "wrong issuer" };
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes("authenticated")) return { status: "invalid", reason: "wrong audience" };
  if (claims.role !== "authenticated") return { status: "invalid", reason: "not a user session" };
  if (!claims.sub) return { status: "invalid", reason: "no subject" };

  return {
    status: "ok",
    claims: {
      sub: claims.sub,
      email: claims.email ?? "",
      exp: claims.exp,
      sessionId: claims.session_id ?? null,
    },
  };
}

/** Clears the key cache. Tests only. */
export function resetJwksCache(): void {
  cache = null;
  inflight = null;
}
