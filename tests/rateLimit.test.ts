import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, checkPerMinute, resetRateLimit } from "../lib/api/rateLimit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimit());

  it("allows up to the limit then blocks", () => {
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit("t:1", 5, 60_000);
      expect(r.allowed).toBe(true);
    }
    const blocked = checkRateLimit("t:1", 5, 60_000);
    expect(blocked.allowed).toBe(false);
  });

  it("is independent per key", () => {
    checkRateLimit("t:a", 2, 60_000);
    checkRateLimit("t:a", 2, 60_000);
    expect(checkRateLimit("t:a", 2, 60_000).allowed).toBe(false);
    expect(checkRateLimit("t:b", 2, 60_000).allowed).toBe(true);
  });

  it("returns remaining + reset", () => {
    const r = checkRateLimit("t:2", 10, 60_000);
    expect(r.limit).toBe(10);
    expect(r.remaining).toBe(9);
    expect(r.resetInSeconds).toBeGreaterThan(0);
  });

  it("checkPerMinute default window", () => {
    for (let i = 0; i < 3; i++) expect(checkPerMinute("t:3", 3).allowed).toBe(true);
    expect(checkPerMinute("t:3", 3).allowed).toBe(false);
  });
});
