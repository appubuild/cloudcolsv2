import { describe, it, expect } from "vitest";
import {
  buildCookie,
  sessionCookies,
  clearedSessionCookies,
  readSession,
  isSameOrigin,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  HINT_COOKIE,
} from "../lib/api/session";

const tokens = { accessToken: "at.value.sig", refreshToken: "rt-value", expiresIn: 3600 };

function req(url: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return new Request(url, init);
}

describe("session cookies", () => {
  it("keeps the tokens where page script cannot read them", () => {
    const [at, rt, hint] = sessionCookies(req("https://cloudcols.com/api/auth/login"), tokens);
    expect(at).toContain(`${ACCESS_COOKIE}=at.value.sig`);
    expect(at).toContain("HttpOnly");
    expect(rt).toContain(`${REFRESH_COOKIE}=rt-value`);
    expect(rt).toContain("HttpOnly");
    // The hint is readable by design — and so carries nothing but "1".
    expect(hint).toBe(`${HINT_COOKIE}=1; Path=/; Max-Age=2592000; Secure; SameSite=Lax`);
  });

  it("is host-only, so it never travels to the CDN host", () => {
    for (const c of sessionCookies(req("https://cloudcols.com/x"), tokens)) expect(c).not.toMatch(/Domain=/i);
  });

  it("is Secure on https and not on plain-http local development", () => {
    expect(sessionCookies(req("https://cloudcols.com/x"), tokens).every((c) => c.includes("Secure"))).toBe(true);
    expect(sessionCookies(req("http://127.0.0.1:8792/x"), tokens).some((c) => c.includes("Secure"))).toBe(false);
  });

  it("expires the access cookie with the token", () => {
    const [at] = sessionCookies(req("https://cloudcols.com/x"), { ...tokens, expiresIn: 1800 });
    expect(at).toContain("Max-Age=1800");
  });

  it("clears all three on sign-out", () => {
    const cleared = clearedSessionCookies(req("https://cloudcols.com/x"));
    expect(cleared).toHaveLength(3);
    for (const c of cleared) expect(c).toContain("Max-Age=0");
  });

  it("builds a Strict cookie when asked", () => {
    expect(buildCookie("cc_admin", "t", { maxAge: 60, secure: true, sameSite: "Strict" })).toContain("SameSite=Strict");
  });
});

describe("readSession", () => {
  it("prefers a Bearer header and ignores cookies entirely", () => {
    const s = readSession(
      req("https://cloudcols.com/api/x", { headers: { authorization: "Bearer bearer-token", cookie: `${ACCESS_COOKIE}=cookie-token` } }),
    );
    expect(s).toEqual({ source: "bearer", accessToken: "bearer-token", refreshToken: null });
  });

  it("reads the cookies when there is no header", () => {
    const s = readSession(
      req("https://cloudcols.com/api/x", { headers: { cookie: `other=1; ${ACCESS_COOKIE}=a; ${REFRESH_COOKIE}=r` } }),
    );
    expect(s).toEqual({ source: "cookie", accessToken: "a", refreshToken: "r" });
  });

  it("still counts a refresh cookie alone as a session to renew", () => {
    const s = readSession(req("https://cloudcols.com/api/x", { headers: { cookie: `${REFRESH_COOKIE}=r` } }));
    expect(s.source).toBe("cookie");
    expect(s.accessToken).toBeNull();
  });

  it("reports no session when there is nothing", () => {
    expect(readSession(req("https://cloudcols.com/api/x")).source).toBeNull();
  });
});

describe("isSameOrigin", () => {
  const url = "https://cloudcols.com/api/profile";

  it("always allows reads", () => {
    expect(isSameOrigin(req(url, { method: "GET", headers: { origin: "https://evil.example" } }))).toBe(true);
  });

  it("allows a write from our own origin", () => {
    expect(isSameOrigin(req(url, { method: "POST", headers: { origin: "https://cloudcols.com" } }))).toBe(true);
  });

  it("compares against the host the request arrived on, not only the URL", () => {
    // Behind a proxy or adapter the URL can name an internal host; the Host header is
    // what the browser connected to.
    const internal = "http://internal.worker/api/profile";
    expect(isSameOrigin(req(internal, { method: "POST", headers: { origin: "http://127.0.0.1:8792", host: "127.0.0.1:8792" } }))).toBe(true);
    expect(isSameOrigin(req(internal, { method: "POST", headers: { origin: "https://evil.example", host: "127.0.0.1:8792" } }))).toBe(false);
  });

  it("refuses an opaque or malformed Origin", () => {
    expect(isSameOrigin(req(url, { method: "POST", headers: { origin: "null" } }))).toBe(false);
  });

  it("refuses a write from another origin", () => {
    expect(isSameOrigin(req(url, { method: "POST", headers: { origin: "https://evil.example" } }))).toBe(false);
    expect(isSameOrigin(req(url, { method: "DELETE", headers: { origin: "https://cloudcols.com.evil.example" } }))).toBe(false);
  });

  it("falls back to Sec-Fetch-Site when there is no Origin", () => {
    expect(isSameOrigin(req(url, { method: "PATCH", headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
    expect(isSameOrigin(req(url, { method: "PATCH", headers: { "sec-fetch-site": "same-origin" } }))).toBe(true);
  });

  it("does not refuse a non-browser client that sends neither", () => {
    expect(isSameOrigin(req(url, { method: "POST" }))).toBe(true);
  });
});
