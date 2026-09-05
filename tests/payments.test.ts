/**
 * The parts of the payment layer that decide whether money means anything.
 *
 * Not a Stripe integration test — that needs Stripe. These cover the logic that
 * is ours and that fails silently when it is wrong: what a plan is worth, what
 * counts as configured, and that the encryption used for stored credentials
 * actually round-trips and actually fails on tampering.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PLANS, isPlanId } from "@/lib/payments/types";

const KEYS = ["SETTINGS_MASTER_KEY"] as const;
const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  process.env.SETTINGS_MASTER_KEY = "a-test-master-key-that-is-long-enough";
});

afterAll(() => {
  for (const k of KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

describe("plans", () => {
  it("prices and quotas come from the server, not the request", () => {
    // The webhook grants PLANS[planId].quota rather than anything the event
    // carried. Stripe reports that money arrived; what it buys is ours to decide.
    expect(PLANS.plan_free.priceCents).toBe(0);
    expect(PLANS.plan_plus.quota).toBeGreaterThan(PLANS.plan_free.quota);
    expect(PLANS.plan_pro.quota).toBeGreaterThan(PLANS.plan_plus.quota);
    expect(PLANS.plan_business.quota).toBeGreaterThan(PLANS.plan_pro.quota);
  });

  it("rejects a plan id it does not know", () => {
    expect(isPlanId("plan_pro")).toBe(true);
    expect(isPlanId("plan_free_but_huge")).toBe(false);
    expect(isPlanId("")).toBe(false);
    // A caller-supplied string reaching the quota update would let anyone name
    // their own plan.
    expect(isPlanId("__proto__")).toBe(false);
  });

  it("only the free plan is free", () => {
    const free = Object.entries(PLANS).filter(([, p]) => p.priceCents === 0);
    expect(free.map(([id]) => id)).toEqual(["plan_free"]);
  });
});

describe("stored credentials", () => {
  it("round-trips a secret", async () => {
    const { sealSecret, openSecret } = await import("@/lib/api/secretBox");
    const secret = JSON.stringify({ secretKey: "sk_test_abc", webhookSecret: "whsec_xyz" });

    const sealed = await sealSecret(secret);
    expect(sealed.ciphertext).not.toContain("sk_test_abc");
    expect(await openSecret(sealed.ciphertext, sealed.iv)).toBe(secret);
  });

  it("uses a fresh IV, so the same value does not encrypt to the same bytes", async () => {
    const { sealSecret } = await import("@/lib/api/secretBox");
    const a = await sealSecret("same");
    const b = await sealSecret("same");
    // Reusing an IV with GCM leaks the difference between two plaintexts
    // encrypted under one key.
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses a tampered ciphertext rather than returning something plausible", async () => {
    const { sealSecret, openSecret } = await import("@/lib/api/secretBox");
    const sealed = await sealSecret("sk_live_real");

    const flipped = sealed.ciphertext.slice(0, -4) + (sealed.ciphertext.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    await expect(openSecret(flipped, sealed.iv)).rejects.toThrow();
  });

  it("refuses to work without a master key rather than using a default", async () => {
    delete process.env.SETTINGS_MASTER_KEY;
    const { sealSecret } = await import("@/lib/api/secretBox");
    // Encrypting under a default key would be worse than not encrypting: it
    // would look protected while every deployment shared one key.
    await expect(sealSecret("anything")).rejects.toThrow(/SETTINGS_MASTER_KEY/);
  });
});
