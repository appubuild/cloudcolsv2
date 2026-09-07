/**
 * The settings registry's validators.
 *
 * These decide what an admin request is allowed to store, and a bad value here is
 * quiet: every reader falls back to its default, so the setting silently stops
 * working while the panel shows it as saved. Worth pinning down.
 */
import { describe, it, expect } from "vitest";
import { SETTINGS, isSettingKey } from "@/lib/settings/system";

describe("setting keys", () => {
  it("recognises declared keys", () => {
    expect(isSettingKey("trash_retention_days")).toBe(true);
    expect(isSettingKey("maintenance_mode")).toBe(true);
  });

  it("refuses anything not declared", () => {
    // A typo must not create a new row that nothing ever reads, leaving the real
    // setting untouched and the admin believing it was saved.
    expect(isSettingKey("trash_retention_dayz")).toBe(false);
    expect(isSettingKey("")).toBe(false);
  });

  it("is not fooled by prototype properties", () => {
    expect(isSettingKey("__proto__")).toBe(false);
    expect(isSettingKey("toString")).toBe(false);
    expect(isSettingKey("constructor")).toBe(false);
  });
});

describe("numeric settings", () => {
  const parse = SETTINGS.trash_retention_days.parse;

  it("accepts a whole number in range", () => {
    expect(parse(30)).toBe(30);
    expect(parse(1)).toBe(1);
  });

  it("refuses zero, negatives and absurd values", () => {
    // Zero-day retention would delete a file the moment it was trashed, taking
    // Restore with it.
    expect(parse(0)).toBeNull();
    expect(parse(-5)).toBeNull();
    expect(parse(999999)).toBeNull();
  });

  it("refuses fractions and junk", () => {
    expect(parse(1.5)).toBeNull();
    expect(parse("30")).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse(NaN)).toBeNull();
    expect(parse(Infinity)).toBeNull();
  });

  it("bounds the file-size ceiling on both sides", () => {
    const size = SETTINGS.max_file_size_bytes.parse;
    expect(size(3 * 1024 * 1024 * 1024)).toBe(3221225472);
    // A ceiling below a megabyte would reject essentially every upload.
    expect(size(1000)).toBeNull();
    expect(size(50 * 1024 * 1024 * 1024)).toBeNull();
  });
});

describe("boolean settings", () => {
  it("takes only real booleans", () => {
    const parse = SETTINGS.maintenance_mode.parse;
    expect(parse(true)).toBe(true);
    expect(parse(false)).toBe(false);
    // "false" is truthy. Storing it would put the product into maintenance for
    // everyone, from a request that meant the opposite.
    expect(parse("false")).toBeNull();
    expect(parse(0)).toBeNull();
    expect(parse(1)).toBeNull();
  });
});

describe("ads_config", () => {
  const parse = SETTINGS.ads_config.parse;

  it("accepts a provider and placement switches", () => {
    expect(parse({ providerId: "ca-pub-123", placements: { sidebar: true, storage_page: false } })).toEqual({
      providerId: "ca-pub-123",
      placements: { sidebar: true, storage_page: false },
    });
  });

  it("fills in an absent provider and absent placements", () => {
    expect(parse({})).toEqual({ providerId: "", placements: {} });
  });

  it("refuses non-boolean placement values", () => {
    // A truthy string here would turn a placement on for everyone on an
    // ad-supported plan, from a request that never said so.
    expect(parse({ placements: { sidebar: "yes" } })).toBeNull();
    expect(parse({ placements: [] as unknown as Record<string, unknown> })).toBeNull();
  });

  it("refuses values that are not objects", () => {
    expect(parse(null)).toBeNull();
    expect(parse("sidebar")).toBeNull();
    expect(parse([1, 2])).toBeNull();
  });
});

describe("deny list", () => {
  it("takes a list of strings and nothing else", () => {
    const parse = SETTINGS.allowed_upload_mime_deny.parse;
    expect(parse(["application/x-sh"])).toEqual(["application/x-sh"]);
    expect(parse([])).toEqual([]);
    expect(parse(["ok", 5])).toBeNull();
    expect(parse("application/x-sh")).toBeNull();
  });
});

describe("public/private split", () => {
  it("keeps the inactivity thresholds off the wire", () => {
    // How long before an account is scheduled for deletion is operational detail;
    // nothing in the browser needs it.
    expect(SETTINGS.inactivity_warn_days.isPublic).toBe(false);
    expect(SETTINGS.inactivity_grace_days.isPublic).toBe(false);
    expect(SETTINGS.allowed_upload_mime_deny.isPublic).toBe(false);
  });

  it("exposes what the UI genuinely needs", () => {
    expect(SETTINGS.ads_enabled.isPublic).toBe(true);
    expect(SETTINGS.maintenance_mode.isPublic).toBe(true);
    expect(SETTINGS.registration_enabled.isPublic).toBe(true);
  });
});
