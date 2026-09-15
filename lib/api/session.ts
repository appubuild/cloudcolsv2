// The web session: httpOnly cookies instead of a token page script can read.
//
// The browser used to hold the Supabase session in localStorage and attach the access
// token to every request itself. Anything that runs on the page can read localStorage
// — one injected script, one compromised dependency — and a stolen refresh token is a
// session that lasts until someone notices. Cookies marked HttpOnly are sent by the
// browser and are invisible to script, which takes that whole class of theft off the
// table.
//
// Three cookies, all host-only (no Domain, so they never travel to the CDN host):
//
//   cc_at          the access token, HttpOnly — what requireUser reads
//   cc_rt          the refresh token, HttpOnly — used only to mint a new cc_at
//   cc_signed_in   "1", readable by the page — carries nothing; it only tells the page
//                  whether asking "who am I?" is worth a request
//
// Bearer tokens still work (the mobile app and scripts send one); a request carrying
// one never looks at the cookies.
//
// Cookies bring back what bearer tokens never had to worry about: another site can
// make the browser send them. SameSite=Lax already withholds them from cross-site
// POSTs in current browsers; isSameOrigin() is the second lock, applied to every
// cookie-authenticated write.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv, serverConfig } from "@/lib/config/server-env";
import { readCookie } from "@/lib/services/deliveryCookie";

/**
 * The address links in emails point at.
 *
 * The configured app URL first, never the request's own Host header: a reset link
 * built from Host can be pointed at an attacker's site by whoever sends the request —
 * the classic password-reset poisoning. The request origin is only the fallback for a
 * deployment with nothing configured.
 */
export function appOrigin(req: Request): string {
  const configured = serverConfig("NEXT_PUBLIC_APP_URL");
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall through */
    }
  }
  return new URL(req.url).origin;
}

/** Session tokens in the shape Supabase hands them back. */
export function tokensFrom(session: { access_token: string; refresh_token: string; expires_in?: number }): SessionTokens {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in ?? 3600,
  };
}

export const ACCESS_COOKIE = "cc_at";
export const REFRESH_COOKIE = "cc_rt";
export const HINT_COOKIE = "cc_signed_in";

/**
 * How long the refresh cookie lives. Supabase decides whether the refresh token itself
 * is still good; this only bounds how long the browser keeps offering it.
 */
const REFRESH_MAX_AGE_S = 30 * 24 * 60 * 60;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

interface CookieOptions {
  maxAge: number;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict";
  secure: boolean;
}

/**
 * One Set-Cookie value.
 *
 * Secure follows the request's own scheme: always on in production, and off only for
 * plain-http local development, where a Secure cookie would simply never be stored.
 */
export function buildCookie(name: string, value: string, opts: CookieOptions): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`,
    opts.httpOnly === false ? null : "HttpOnly",
    opts.secure ? "Secure" : null,
    `SameSite=${opts.sameSite ?? "Lax"}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === "https:";
}

/** The three cookies that establish a session. */
export function sessionCookies(req: Request, tokens: SessionTokens): string[] {
  const secure = isSecureRequest(req);
  return [
    buildCookie(ACCESS_COOKIE, tokens.accessToken, { maxAge: Math.max(60, tokens.expiresIn), secure }),
    buildCookie(REFRESH_COOKIE, tokens.refreshToken, { maxAge: REFRESH_MAX_AGE_S, secure }),
    buildCookie(HINT_COOKIE, "1", { maxAge: REFRESH_MAX_AGE_S, httpOnly: false, secure }),
  ];
}

/** The same three, expired — what signing out and a dead refresh token both send. */
export function clearedSessionCookies(req: Request): string[] {
  const secure = isSecureRequest(req);
  return [
    buildCookie(ACCESS_COOKIE, "", { maxAge: 0, secure }),
    buildCookie(REFRESH_COOKIE, "", { maxAge: 0, secure }),
    buildCookie(HINT_COOKIE, "", { maxAge: 0, httpOnly: false, secure }),
  ];
}

export interface RequestSession {
  source: "bearer" | "cookie" | null;
  accessToken: string | null;
  refreshToken: string | null;
}

/**
 * Where this request's credentials came from.
 *
 * A Bearer header wins and the cookies are then ignored entirely — a script that
 * sends a token should get exactly that token's identity, not whatever a browser
 * happened to have stored alongside.
 */
export function readSession(req: Request): RequestSession {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (bearer) return { source: "bearer", accessToken: bearer, refreshToken: null };

  const header = req.headers.get("cookie");
  const accessToken = readCookie(header, ACCESS_COOKIE) || null;
  const refreshToken = readCookie(header, REFRESH_COOKIE) || null;
  if (!accessToken && !refreshToken) return { source: null, accessToken: null, refreshToken: null };
  return { source: "cookie", accessToken, refreshToken };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a cookie-authenticated request came from this site's own pages.
 *
 * Reads are always allowed: a cross-site page can make the browser send a GET, but
 * the same-origin policy stops it reading the answer. For anything that changes
 * state, the browser's own Origin header (or, failing that, Sec-Fetch-Site) must say
 * the request came from here. A request with neither is not a browser — and anything
 * that is not a browser and still holds the cookie had the cookie already.
 */
export function isSameOrigin(req: Request): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return false; // "null" (sandboxed frames, file://) or garbage
    }
    // The host the browser actually connected to. Not req.url alone: behind the
    // Workers adapter the URL a route sees need not carry the public host, and a
    // check against it refused the site's own sign-up form.
    const hosts = new Set<string>();
    const host = req.headers.get("host");
    if (host) hosts.add(host.toLowerCase());
    hosts.add(new URL(req.url).host.toLowerCase());
    const configured = serverConfig("NEXT_PUBLIC_APP_URL");
    if (configured) {
      try {
        hosts.add(new URL(configured).host.toLowerCase());
      } catch {
        /* ignore a malformed setting */
      }
    }
    return hosts.has(originHost);
  }

  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";

  return true;
}

/** A Supabase client with no stored session, for one auth call. */
export function isolatedAuthClient() {
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Exchanges a refresh token for a new session, or null if Supabase refuses it. */
export async function refreshTokens(refreshToken: string): Promise<SessionTokens | null> {
  try {
    const { data, error } = await isolatedAuthClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) return null;
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in ?? 3600,
    };
  } catch {
    return null;
  }
}
