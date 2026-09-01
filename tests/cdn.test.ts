import { describe, it, expect } from "vitest";
import { buildCdnUrl, readableUrl } from "../lib/services/cdn";

describe("cdn signed tickets", () => {
  it("returns null when no secret/domain configured (local/mock)", () => {
    delete process.env.CDN_TICKET_SECRET;
    delete process.env.CDN_DOMAIN;
    expect(buildCdnUrl("u/f/cat/x.png")).toBeNull();
  });

  it("builds a signed URL when configured", () => {
    process.env.CDN_TICKET_SECRET = "s3cr3t";
    process.env.CDN_DOMAIN = "https://cdn.example.com/";
    const url = buildCdnUrl("user-1/user-files/image/x.png");
    expect(url).toContain("https://cdn.example.com/v1/object?key=");
    expect(url).toContain("exp=");
    expect(url).toContain("sig=");
    expect(url).toContain(encodeURIComponent("user-1/user-files/image/x.png"));
    delete process.env.CDN_TICKET_SECRET;
    delete process.env.CDN_DOMAIN;
  });

  it("readableUrl falls back to B2 public domain when no ticket secret", () => {
    delete process.env.CDN_TICKET_SECRET;
    delete process.env.CDN_DOMAIN;
    process.env.B2_PUBLIC_DOMAIN = "files.example.com";
    expect(readableUrl("u/f.png")).toBe("https://files.example.com/u/f.png");
    delete process.env.B2_PUBLIC_DOMAIN;
  });
});
