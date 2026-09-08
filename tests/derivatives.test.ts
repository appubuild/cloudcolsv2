/**
 * Where a thumbnail lives.
 *
 * The key is derived from the original's, never stored and never accepted from a
 * client — a client-supplied path is how a "thumbnail" upload becomes a write to
 * somebody else's object. So the derivation has to be right, and it has to keep two
 * files apart that differ only in ways the derivation might drop.
 */
import { describe, it, expect } from "vitest";
import { thumbnailKey, canHaveThumbnail, THUMBNAIL_MAX_BYTES } from "@/lib/storage/derivatives";

const key = (u: string, rest: string) => `${u}/user-files/${rest}`;

describe("thumbnailKey", () => {
  it("puts the derivative under the same owner", () => {
    const owner = "11111111-2222-3333-4444-555555555555";
    const out = thumbnailKey(key(owner, "image/2026/09/CC-abc123.png"));
    // The owner prefix is what keeps one account's derivatives out of another's.
    expect(out.startsWith(`${owner}/`)).toBe(true);
    expect(out).toBe(`${owner}/derivatives/thumbs/CC-abc123.webp`);
  });

  it("is deterministic", () => {
    const k = key("u1", "image/2026/09/CC-xyz.jpg");
    expect(thumbnailKey(k)).toBe(thumbnailKey(k));
  });

  it("keeps two files apart", () => {
    // Object keys carry a uuid, so two uploads of the same filename differ here —
    // and their derivatives must differ too, or one would overwrite the other.
    const a = thumbnailKey(key("u1", "image/2026/09/CC-aaa.png"));
    const b = thumbnailKey(key("u1", "image/2026/09/CC-bbb.png"));
    expect(a).not.toBe(b);
  });

  it("does not let one account's key produce another's derivative path", () => {
    const a = thumbnailKey(key("owner-a", "image/2026/09/CC-same.png"));
    const b = thumbnailKey(key("owner-b", "image/2026/09/CC-same.png"));
    expect(a).not.toBe(b);
  });

  it("always ends in .webp, whatever the original was", () => {
    for (const ext of ["png", "jpeg", "HEIC", "mp4", "tar.gz"]) {
      expect(thumbnailKey(key("u1", `image/2026/09/CC-a.${ext}`))).toMatch(/\.webp$/);
    }
  });

  it("survives a key with no extension or no path", () => {
    expect(thumbnailKey("u1/user-files/image/2026/09/CC-noext")).toBe("u1/derivatives/thumbs/CC-noext.webp");
    expect(thumbnailKey("lonely")).toBe("lonely/derivatives/thumbs/lonely.webp");
  });
});

describe("canHaveThumbnail", () => {
  it("covers what a browser can draw", () => {
    expect(canHaveThumbnail("image")).toBe(true);
    expect(canHaveThumbnail("video")).toBe(true);
    // PDFs need pdf.js to rasterise, which is why they were left out at first. A
    // folder of them was then a wall of identical red glyphs, so they are in now.
    expect(canHaveThumbnail("pdf")).toBe(true);
  });

  it("leaves everything else to its icon", () => {
    for (const c of ["audio", "document", "archive", "other", ""]) {
      expect(canHaveThumbnail(c)).toBe(false);
    }
  });
});

describe("size ceiling", () => {
  it("is small enough to be worth the round trip", () => {
    // The whole point is not fetching the original. A ceiling anywhere near a
    // typical photo would defeat it.
    expect(THUMBNAIL_MAX_BYTES).toBeLessThanOrEqual(1024 * 1024);
    expect(THUMBNAIL_MAX_BYTES).toBeGreaterThan(64 * 1024);
  });
});
