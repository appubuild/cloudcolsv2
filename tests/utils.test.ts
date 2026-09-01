import { describe, it, expect } from "vitest";
import { formatBytes, formatPercent, formatDate, uuid } from "@/lib/utils";

describe("formatBytes", () => {
  it("formats zero", () => expect(formatBytes(0)).toBe("0 B"));
  it("formats bytes", () => expect(formatBytes(512)).toBe("512 B"));
  it("formats kilobytes", () => expect(formatBytes(2048)).toBe("2 KB"));
  it("formats megabytes", () => expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB"));
  it("formats gigabytes", () => expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2 GB"));
  it("formats terabytes", () => expect(formatBytes(3 * 1024 * 1024 * 1024 * 1024)).toBe("3 TB"));
});

describe("formatPercent", () => {
  it("clamps below zero", () => expect(formatPercent(-5)).toBe("0%"));
  it("clamps above 100", () => expect(formatPercent(150)).toBe("100%"));
  it("rounds", () => expect(formatPercent(42.6)).toBe("43%"));
});

describe("formatDate", () => {
  it("handles null", () => expect(formatDate(null)).toBe("—"));
  it("handles invalid", () => expect(formatDate("not-a-date")).toBe("—"));
});

describe("uuid", () => {
  it("produces a 36-char uuid", () => expect(uuid()).toHaveLength(36));
  it("is unique", () => expect(uuid()).not.toBe(uuid()));
});
