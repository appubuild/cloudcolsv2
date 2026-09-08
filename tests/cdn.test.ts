import { describe, it, expect, afterEach } from "vitest";
import { cdnUrl, cdnConfigured, readableUrl } from "../lib/services/cdn";
import {
  canonicalTicket,
  signTicket,
  signaturesMatch,
  parseTicket,
  edgeCacheable,
  cacheHeaderFor,
} from "../lib/services/cdnTicket";

const SECRET = "s3cr3t";

function configure() {
  process.env.CDN_TICKET_SECRET = SECRET;
  process.env.CDN_DOMAIN = "https://cdn.example.com/";
}

afterEach(() => {
  delete process.env.CDN_TICKET_SECRET;
  delete process.env.CDN_DOMAIN;
});

describe("cdn configuration", () => {
  it("is not configured when the secret or the domain is missing", async () => {
    expect(cdnConfigured()).toBe(false);
    expect(await cdnUrl("u/f/x.png", { deliveryClass: "p" })).toBeNull();

    process.env.CDN_DOMAIN = "https://cdn.example.com";
    expect(cdnConfigured()).toBe(false); // domain alone would mint unsigned URLs
  });

  it("never falls back to a raw B2 URL", async () => {
    // The old behaviour returned an unauthenticated bucket URL, which 403s against a
    // private bucket while making an unconfigured CDN look configured.
    process.env.B2_PUBLIC_DOMAIN = "files.example.com";
    expect(await readableUrl("u/f.png")).toBeNull();
    delete process.env.B2_PUBLIC_DOMAIN;
  });
});

describe("cdn ticket URLs", () => {
  it("builds a signed URL against the worker's object route", async () => {
    configure();
    const url = await cdnUrl("user-1/user-files/image/x.png", { deliveryClass: "t" });
    expect(url).toContain("https://cdn.example.com/v1/object?");
    expect(url).toContain(`key=${encodeURIComponent("user-1/user-files/image/x.png")}`);
    expect(url).toContain("c=t");
    expect(url).toMatch(/sig=[0-9a-f]{64}/);
  });

  it("is stable within a window, so a cache can actually hit", async () => {
    configure();
    const a = await cdnUrl("user-1/user-files/image/x.png", { deliveryClass: "t" });
    const b = await cdnUrl("user-1/user-files/image/x.png", { deliveryClass: "t" });
    // Two renders of the same grid tile must produce the same cache key. An
    // unquantised `now + ttl` expiry would make these differ and miss every time.
    expect(a).toBe(b);
  });

  it("signs the delivery class, so a holder cannot ask for private bytes to be cached", async () => {
    configure();
    const priv = await cdnUrl("user-1/user-files/video/x.mp4", { deliveryClass: "p" });
    const params = new URLSearchParams(new URL(priv!).search);
    const parsed = parseTicket(params)!;

    const forged = { ...parsed.options, deliveryClass: "t" as const };
    const expected = await signTicket(SECRET, forged);
    expect(signaturesMatch(expected, parsed.signature)).toBe(false);
  });

  it("signs the disposition, so a view link cannot be flipped into a download", async () => {
    configure();
    const inline = await cdnUrl("user-1/user-files/doc/x.pdf", {
      deliveryClass: "p",
      disposition: "inline",
    });
    const parsed = parseTicket(new URLSearchParams(new URL(inline!).search))!;
    const forged = { ...parsed.options, disposition: "a" as const, filename: "x.pdf" };
    const expected = await signTicket(SECRET, forged);
    expect(signaturesMatch(expected, parsed.signature)).toBe(false);
  });

  it("round-trips every signed field", async () => {
    configure();
    const url = await cdnUrl("user-1/user-files/doc/x.pdf", {
      deliveryClass: "s",
      disposition: "attachment",
      filename: "Quarterly Report.pdf",
      contentType: "application/pdf",
    });
    const parsed = parseTicket(new URLSearchParams(new URL(url!).search))!;
    expect(parsed.options.objectKey).toBe("user-1/user-files/doc/x.pdf");
    expect(parsed.options.filename).toBe("Quarterly Report.pdf");
    expect(parsed.options.contentType).toBe("application/pdf");
    expect(await signTicket(SECRET, parsed.options)).toBe(parsed.signature);
  });
});

describe("ticket primitives", () => {
  it("separates fields so they cannot be shifted between each other", () => {
    // Without a separator, key "a" + exp "12" and key "a1" + exp "2" would sign the
    // same bytes, and a holder could rewrite one into the other.
    const a = canonicalTicket({ objectKey: "a", expiresAt: 12, deliveryClass: "p", disposition: "i" });
    const b = canonicalTicket({ objectKey: "a1", expiresAt: 2, deliveryClass: "p", disposition: "i" });
    expect(a).not.toBe(b);
  });

  it("rejects an unknown delivery class rather than defaulting to one", () => {
    const p = new URLSearchParams({ key: "k", exp: "1", c: "x", d: "i", sig: "ab" });
    expect(parseTicket(p)).toBeNull();
  });

  it("rejects a missing signature", () => {
    const p = new URLSearchParams({ key: "k", exp: "1", c: "p", d: "i" });
    expect(parseTicket(p)).toBeNull();
  });

  it("allows the edge to hold only thumbnails and share assets", () => {
    expect(edgeCacheable("t")).toBe(true);
    expect(edgeCacheable("s")).toBe(true);
    expect(edgeCacheable("p")).toBe(false);
  });

  it("never marks a response public", () => {
    for (const c of ["t", "s", "p"] as const) {
      expect(cacheHeaderFor(c)).toContain("private");
      expect(cacheHeaderFor(c)).not.toContain("public");
    }
  });

  it("compares signatures without leaking length-independent early exits", () => {
    expect(signaturesMatch("abc", "abc")).toBe(true);
    expect(signaturesMatch("abc", "abd")).toBe(false);
    expect(signaturesMatch("", "")).toBe(false);
  });
});
