/**
 * What may be stored, and how it may be served.
 *
 * The policy changed, so these tests did too. It used to refuse .html, .svg, .js and
 * every extension it had not heard of — which made the product useless for the files
 * people actually keep, while defending against a risk that is not storage.
 *
 * The rule now: everything can be stored; nothing a browser would execute is ever
 * served inline. These tests pin the second half, because it is the half that is a
 * security control.
 */
import { describe, it, expect } from "vitest";
import { validateMime, mustDownload, isTextEditable, extensionOf } from "@/lib/services/mime";

describe("what may be stored", () => {
  it("accepts what it used to refuse", () => {
    for (const name of ["watch.htm", "page.html", "icon.svg", "app.js", "setup.exe", "lib.dll", "run.sh"]) {
      expect(validateMime(name, null).allowed).toBe(true);
    }
  });

  it("accepts an extension it has never seen", () => {
    // A storage product holds whatever somebody has. An unknown blob is a fine thing
    // to keep; refusing it was the bug.
    const r = validateMime("project.sketch", null);
    expect(r.allowed).toBe(true);
    expect(r.effectiveMime).toBe("application/octet-stream");
  });

  it("accepts a file with no extension at all", () => {
    expect(validateMime("Makefile", null).allowed).toBe(true);
  });

  it("trusts the extension over a mismatched claim", () => {
    // A .png announced as text/html is a .png. The server's reading wins, which is
    // also what stops a claimed type deciding how the file is served.
    expect(validateMime("photo.png", "text/html").effectiveMime).toBe("image/png");
  });

  it("falls back to a claimed type only when it is a real MIME type", () => {
    expect(validateMime("thing.weird", "application/vnd.acme").effectiveMime).toBe("application/vnd.acme");
    expect(validateMime("thing.weird", "not a mime type").effectiveMime).toBe("application/octet-stream");
    expect(validateMime("thing.weird", "<script>").effectiveMime).toBe("application/octet-stream");
  });
});

describe("what is never served inline", () => {
  it("forces a download for markup a browser would render", () => {
    for (const name of ["page.html", "watch.htm", "doc.xhtml", "feed.xml", "icon.svg"]) {
      expect(mustDownload(name, null)).toBe(true);
    }
  });

  it("forces a download for script", () => {
    for (const name of ["app.js", "mod.mjs", "index.php"]) {
      expect(mustDownload(name, null)).toBe(true);
    }
  });

  it("catches a dangerous type hiding behind a harmless name", () => {
    // report.pdf stored as text/html would otherwise be served inline and rendered.
    expect(mustDownload("report.pdf", "text/html")).toBe(true);
    expect(mustDownload("photo.png", "image/svg+xml")).toBe(true);
  });

  it("catches a dangerous name whose stored type says nothing", () => {
    expect(mustDownload("page.html", "application/octet-stream")).toBe(true);
  });

  it("leaves ordinary media alone, so previews still work", () => {
    expect(mustDownload("photo.png", "image/png")).toBe(false);
    expect(mustDownload("clip.mp4", "video/mp4")).toBe(false);
    expect(mustDownload("song.mp3", "audio/mpeg")).toBe(false);
    expect(mustDownload("report.pdf", "application/pdf")).toBe(false);
    expect(mustDownload("notes.md", "text/markdown")).toBe(false);
  });
});

describe("what can be edited as text", () => {
  it("covers the text formats people actually edit", () => {
    for (const name of ["notes.md", "data.json", "page.html", "style.css", "notes.txt", "config.yml", "q.sql"]) {
      expect(isTextEditable(name, null)).toBe(true);
    }
  });

  it("refuses binary document formats", () => {
    // Opening a .docx in a text editor shows a wall of bytes and offers to save it
    // back corrupted. Saying no is the honest answer.
    for (const name of ["report.docx", "sheet.xlsx", "deck.pptx", "report.pdf", "photo.png", "clip.mp4"]) {
      expect(isTextEditable(name, null)).toBe(false);
    }
  });

  it("accepts anything the server recorded as text", () => {
    expect(isTextEditable("thing.unknown", "text/plain")).toBe(true);
    expect(isTextEditable("thing.unknown", "application/json")).toBe(true);
    expect(isTextEditable("thing.unknown", "application/octet-stream")).toBe(false);
  });
});

describe("extensionOf", () => {
  it("lowercases and strips anything odd", () => {
    expect(extensionOf("Photo.PNG")).toBe("png");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("weird.p<n>g")).toBe("png");
  });

  it("returns nothing for a name with no extension", () => {
    expect(extensionOf("Makefile")).toBe("");
  });
});
