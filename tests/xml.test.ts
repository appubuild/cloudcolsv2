/**
 * Reading storage's XML replies.
 *
 * This exists because the first version of it was a regex built with `new RegExp`
 * from a template literal, where `\s` and `\S` are not escape sequences the literal
 * recognises. It silently became `[sS]` — a class matching two letters — and so it
 * compiled, ran, and never matched an upload id. Every multipart upload failed with
 * "storage did not return an upload id" while storage was answering correctly.
 *
 * A unit test would have caught it in a second. It took a 40 MB upload against real
 * Backblaze instead.
 */
import { describe, it, expect } from "vitest";
import { xmlTag } from "@/lib/services/b2";

const INITIATE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <Bucket>cloudcols-prod</Bucket>
      <Key>ba7fc16d/user-files/video/2026/09/CC-9ac72f41.mp4</Key>
      <UploadId>4_zabc123_f200000_d20260906_m024512_c005_v0501000_t0000</UploadId>
  </InitiateMultipartUploadResult>`;

describe("xmlTag", () => {
  it("reads a value that spans no lines", () => {
    expect(xmlTag(INITIATE, "Bucket")).toBe("cloudcols-prod");
  });

  it("reads an upload id containing digits, letters and underscores", () => {
    // The exact failure: the broken class matched only s and S, so anything real
    // came back null.
    expect(xmlTag(INITIATE, "UploadId")).toBe("4_zabc123_f200000_d20260906_m024512_c005_v0501000_t0000");
  });

  it("reads a value that contains slashes and dots", () => {
    expect(xmlTag(INITIATE, "Key")).toBe("ba7fc16d/user-files/video/2026/09/CC-9ac72f41.mp4");
  });

  it("trims the whitespace of a pretty-printed value", () => {
    expect(xmlTag("<A>\n   hello  \n</A>", "A")).toBe("hello");
  });

  it("handles a value spanning lines", () => {
    expect(xmlTag("<A>one\ntwo</A>", "A")).toBe("one\ntwo");
  });

  it("returns null rather than guessing", () => {
    expect(xmlTag(INITIATE, "Nope")).toBeNull();
    expect(xmlTag("<A>unclosed", "A")).toBeNull();
    expect(xmlTag("", "A")).toBeNull();
  });

  it("takes the first occurrence, not everything between the first and last", () => {
    // A greedy match would return "one</A><A>two".
    expect(xmlTag("<A>one</A><A>two</A>", "A")).toBe("one");
  });

  it("does not confuse a tag with one that merely starts the same way", () => {
    expect(xmlTag("<UploadIdMarker>x</UploadIdMarker><UploadId>real</UploadId>", "UploadId")).toBe("real");
  });
});
