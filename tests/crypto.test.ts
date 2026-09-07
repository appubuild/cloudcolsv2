import { describe, it, expect } from "vitest";
import { generateApiKey, hashSecret, hmacSign, hmacVerify, safeEqual, secretEqual, randomHex } from "../lib/api/crypto";

describe("crypto", () => {
  it("hashes are deterministic & not reversible", () => {
    expect(hashSecret("secret")).toBe(hashSecret("secret"));
    expect(hashSecret("secret")).toHaveLength(64);
    expect(hashSecret("secret")).not.toBe("secret");
  });

  it("safeEqual compares correctly", () => {
    const a = hashSecret("x");
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, hashSecret("y"))).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("secretEqual compares non-hex secrets without truncating them", () => {
    expect(secretEqual("jobs-token-value", "jobs-token-value")).toBe(true);
    expect(secretEqual("jobs-token-value", "jobs-token-valuf")).toBe(false);
    // Different lengths must not throw, and must not match.
    expect(secretEqual("short", "a-much-longer-token")).toBe(false);
    // An empty or missing secret never matches — this is what makes the jobs
    // endpoint fail closed rather than open when nothing is configured.
    expect(secretEqual("", "")).toBe(false);
    expect(secretEqual("", "anything")).toBe(false);
    expect(secretEqual("anything", "")).toBe(false);
    // safeEqual would have treated both of these as the same empty buffer,
    // because neither is valid hex. secretEqual must not.
    expect(secretEqual("zzzz", "wwww")).toBe(false);
  });

  it("generateApiKey produces raw/prefix/hash", () => {
    const k = generateApiKey();
    expect(k.raw.startsWith("cc_live_")).toBe(true);
    expect(k.prefix).toBe(k.raw.slice(0, 14));
    expect(k.hash).toBe(hashSecret(k.raw));
    expect(k.hash).not.toContain(k.raw);
  });

  it("hmac sign/verify roundtrips", () => {
    const sig = hmacSign("secret", "payload");
    expect(sig).toHaveLength(64);
    expect(hmacVerify("secret", "payload", sig)).toBe(true);
    expect(hmacVerify("secret", "payload", "deadbeef")).toBe(false);
    expect(hmacVerify("secret", "different", sig)).toBe(false);
  });

  it("randomHex length", () => {
    expect(randomHex(8)).toHaveLength(16);
    expect(randomHex(16)).toHaveLength(32);
  });
});
