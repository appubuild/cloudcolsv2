import { describe, it, expect } from "vitest";
import { validateMime, EXT_BLOCK } from "../lib/services/mime";

describe("validateMime (upload security)", () => {
  it("allows known image/video/audio/document extensions", () => {
    expect(validateMime("photo.jpg").allowed).toBe(true);
    expect(validateMime("photo.jpg").effectiveMime).toBe("image/jpeg");
    expect(validateMime("clip.mp4").effectiveMime).toBe("video/mp4");
    expect(validateMime("song.mp3").effectiveMime).toBe("audio/mpeg");
    expect(validateMime("doc.pdf").effectiveMime).toBe("application/pdf");
    expect(validateMime("sheet.xlsx").allowed).toBe(true);
  });

  it("blocks executables/scripts regardless of MIME claim", () => {
    expect(validateMime("malware.exe", "image/png").allowed).toBe(false);
    expect(validateMime("script.js", "text/javascript").allowed).toBe(false);
    expect(validateMime("page.html", "image/jpeg").allowed).toBe(false);
    expect(validateMime("run.sh").allowed).toBe(false);
  });

  it("rejects unknown/suspicious extensions", () => {
    expect(validateMime("file.xyz").allowed).toBe(false);
    expect(validateMime("noext").allowed).toBe(false);
  });

  it("uses server-authoritative MIME even if the client lies", () => {
    const r = validateMime("photo.jpg", "application/x-msdownload");
    expect(r.allowed).toBe(true);
    expect(r.effectiveMime).toBe("image/jpeg"); // canonical, not the claimed one
  });

  it("EXT_BLOCK contains the dangerous set", () => {
    for (const ext of ["exe", "js", "php", "sh", "bat", "html"]) {
      expect(EXT_BLOCK.has(ext)).toBe(true);
    }
  });
});
