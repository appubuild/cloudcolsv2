import { describe, it, expect } from "vitest";
import {
  DELIVERY_COOKIE,
  mintDeliveryCookie,
  verifyDeliveryCookie,
  readCookie,
  cookieDomainFor,
} from "../lib/services/deliveryCookie";

const SECRET = "verification-only";
const hour = () => Date.now() + 60 * 60 * 1000;

describe("delivery cookie", () => {
  it("round-trips the account it names", async () => {
    const exp = hour();
    const value = await mintDeliveryCookie(SECRET, "user-a", exp);
    expect(await verifyDeliveryCookie(SECRET, value)).toEqual({ userId: "user-a", expiresAt: exp });
  });

  it("refuses a cookie signed with another secret", async () => {
    const value = await mintDeliveryCookie("someone-elses-secret", "user-a", hour());
    expect(await verifyDeliveryCookie(SECRET, value)).toBeNull();
  });

  it("refuses a rewritten account", async () => {
    // The whole point: holding a valid cookie for yourself must not let you claim to
    // be somebody else, or a bound link would only be bound to "any signed-in user".
    const exp = hour();
    const mine = await mintDeliveryCookie(SECRET, "user-a", exp);
    const forged = mine.replace("user-a", "user-b");
    expect(await verifyDeliveryCookie(SECRET, forged)).toBeNull();
  });

  it("refuses a stretched expiry", async () => {
    const value = await mintDeliveryCookie(SECRET, "user-a", Date.now() + 1000);
    const stretched = value.replace(/\.\d+\./, `.${Date.now() + 999_999_999}.`);
    expect(await verifyDeliveryCookie(SECRET, stretched)).toBeNull();
  });

  it("refuses one that has run out", async () => {
    const value = await mintDeliveryCookie(SECRET, "user-a", Date.now() - 1);
    expect(await verifyDeliveryCookie(SECRET, value)).toBeNull();
  });

  it("refuses nonsense rather than throwing", async () => {
    for (const bad of ["", "x", "v1.a.b", "v2.a.1.ff", "....", null, undefined]) {
      expect(await verifyDeliveryCookie(SECRET, bad as string)).toBeNull();
    }
  });
});

describe("readCookie", () => {
  it("finds one among several", () => {
    expect(readCookie(`a=1; ${DELIVERY_COOKIE}=wanted; b=2`, DELIVERY_COOKIE)).toBe("wanted");
  });

  it("does not match a name that merely ends the same way", () => {
    expect(readCookie(`x${DELIVERY_COOKIE}=no`, DELIVERY_COOKIE)).toBeNull();
  });

  it("copes with no header at all", () => {
    expect(readCookie(null, DELIVERY_COOKIE)).toBeNull();
    expect(readCookie("", DELIVERY_COOKIE)).toBeNull();
  });
});

describe("cookieDomainFor", () => {
  it("scopes to what the app and the CDN share", () => {
    expect(cookieDomainFor("cloudcols.com", "cdn.cloudcols.com")).toBe("cloudcols.com");
    expect(cookieDomainFor("www.cloudcols.com", "cdn.cloudcols.com")).toBe("cloudcols.com");
    expect(cookieDomainFor("app.a.example.co.uk", "cdn.a.example.co.uk")).toBe("a.example.co.uk");
  });

  it("ignores scheme and port", () => {
    expect(cookieDomainFor("https://cloudcols.com", "https://cdn.cloudcols.com/")).toBe("cloudcols.com");
    expect(cookieDomainFor("localhost:3000", "localhost:8802")).toBeNull();
  });

  it("refuses to hand a cookie to a public suffix", () => {
    // "com" is shared by every .com in the world; no browser would accept it, and
    // returning it would be an attempt to scope a cookie to the entire internet.
    expect(cookieDomainFor("cloudcols.com", "cdn.example.com")).toBeNull();
  });

  it("returns null when there is nothing in common", () => {
    expect(cookieDomainFor("cloudcols.com", "files.b2.backblazeb2.com")).toBeNull();
    expect(cookieDomainFor("", "cdn.cloudcols.com")).toBeNull();
    expect(cookieDomainFor("cloudcols.com", "")).toBeNull();
  });
});
