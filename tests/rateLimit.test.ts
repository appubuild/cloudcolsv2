import { describe, it, expect, beforeEach, vi } from "vitest";

// Stands in for the Worker's bindings. `null` means "not running on Workers", which is
// what next dev and vitest actually are.
let bindings: Record<string, unknown> | null = null;
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!bindings) throw new Error("not on Workers");
    return { env: bindings };
  },
}));

import { checkRateLimit, checkPerMinute, resetRateLimit } from "../lib/api/rateLimit";

describe("rateLimit (local fallback)", () => {
  beforeEach(() => {
    bindings = null;
    resetRateLimit();
  });

  it("allows up to the limit then blocks", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit("t:1", 5, 60_000);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkRateLimit("t:1", 5, 60_000);
    expect(blocked.allowed).toBe(false);
  });

  it("is independent per key", async () => {
    await checkRateLimit("t:a", 2, 60_000);
    await checkRateLimit("t:a", 2, 60_000);
    expect((await checkRateLimit("t:a", 2, 60_000)).allowed).toBe(false);
    expect((await checkRateLimit("t:b", 2, 60_000)).allowed).toBe(true);
  });

  it("returns remaining + reset", async () => {
    const r = await checkRateLimit("t:2", 10, 60_000);
    expect(r.limit).toBe(10);
    expect(r.remaining).toBe(9);
    expect(r.resetInSeconds).toBeGreaterThan(0);
  });

  it("checkPerMinute default window", async () => {
    for (let i = 0; i < 3; i++) expect((await checkPerMinute("t:3", 3)).allowed).toBe(true);
    expect((await checkPerMinute("t:3", 3)).allowed).toBe(false);
  });
});

describe("rateLimit (Durable Object)", () => {
  beforeEach(() => resetRateLimit());

  it("counts in the Durable Object named by the key, not locally", async () => {
    const names: string[] = [];
    const hit = vi.fn(async (limit: number) => ({ allowed: false, limit, remaining: 0, resetInSeconds: 42 }));
    bindings = {
      RATE_LIMITER: {
        idFromName: (name: string) => {
          names.push(name);
          return `id:${name}`;
        },
        get: () => ({ hit }),
      },
    };

    const r = await checkRateLimit("login:203.0.113.7", 10, 60_000);
    expect(names).toEqual(["login:203.0.113.7"]);
    expect(hit).toHaveBeenCalledWith(10, 60_000);
    // The Durable Object's verdict is the one returned — a fresh local counter would
    // have said "allowed".
    expect(r).toEqual({ allowed: false, limit: 10, remaining: 0, resetInSeconds: 42 });
  });

  it("still limits, locally, when the Durable Object cannot be reached", async () => {
    bindings = {
      RATE_LIMITER: {
        idFromName: (n: string) => n,
        get: () => ({
          hit: async () => {
            throw new Error("Durable Object reset");
          },
        }),
      },
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 2; i++) expect((await checkRateLimit("t:do", 2, 60_000)).allowed).toBe(true);
    expect((await checkRateLimit("t:do", 2, 60_000)).allowed).toBe(false);
    err.mockRestore();
  });
});
