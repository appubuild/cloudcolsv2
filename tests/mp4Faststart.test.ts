import { describe, it, expect } from "vitest";
import { mp4Faststart, looksLikeMp4 } from "../lib/services/mp4Faststart";

/**
 * Building real MP4s to test against.
 *
 * The transform rewrites absolute file offsets, so the only test worth writing is one
 * that follows those offsets afterwards and checks they still land on the same bytes.
 * Asserting the box order alone would pass just as happily on a corrupt file.
 */

const enc = new TextEncoder();

function box(type: string, ...payloads: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = payloads.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(8 + body);
  new DataView(out.buffer).setUint32(0, out.byteLength);
  out.set(enc.encode(type), 4);
  let at = 8;
  for (const p of payloads) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

function u32(...values: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v));
  return out;
}

function u64(...values: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length * 8);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => {
    view.setUint32(i * 8, Math.floor(v / 2 ** 32));
    view.setUint32(i * 8 + 4, v >>> 0);
  });
  return out;
}

/** stco: version+flags, entry count, then one absolute offset per chunk. */
const stco = (offsets: number[]) => box("stco", u32(0), u32(offsets.length), u32(...offsets));
const co64 = (offsets: number[]) => box("co64", u32(0), u32(offsets.length), u64(...offsets));

/** A four-byte marker written into mdat so a chunk can be recognised after moving. */
function marker(n: number): Uint8Array<ArrayBuffer> {
  return u32(0xc0de0000 + n);
}

interface Built {
  file: Blob;
  /** Where each chunk marker sits in the original file. */
  chunkOffsets: number[];
  markers: number[];
}

/**
 * `ftyp | mdat | moov` — the camera layout, which is what needs fixing.
 *
 * `chunkCount` markers are spread through mdat and their absolute offsets recorded in
 * the offset table, exactly as a real muxer would.
 */
function buildCameraMp4(opts: { mdatBytes: number; chunkCount: number; wide?: boolean }): Built {
  const ftyp = box("ftyp", enc.encode("isom"), u32(512), enc.encode("isomavc1"));

  const payload = new Uint8Array(opts.mdatBytes);
  const mdatStart = ftyp.byteLength;
  const mdatBodyStart = mdatStart + 8;

  const chunkOffsets: number[] = [];
  const markers: number[] = [];
  const stride = Math.floor(opts.mdatBytes / (opts.chunkCount + 1));
  for (let i = 0; i < opts.chunkCount; i += 1) {
    const at = stride * (i + 1);
    payload.set(marker(i), at);
    chunkOffsets.push(mdatBodyStart + at);
    markers.push(0xc0de0000 + i);
  }
  const mdat = box("mdat", payload);

  const table = opts.wide ? co64(chunkOffsets) : stco(chunkOffsets);
  const stbl = box("stbl", box("stsd", u32(0), u32(0)), table);
  const moov = box("moov", box("mvhd", u32(0)), box("trak", box("mdia", box("minf", stbl))));

  return { file: new Blob([ftyp, mdat, moov]), chunkOffsets, markers };
}

/** Reads the offset table back out of a rewritten file. */
async function readOffsets(blob: Blob): Promise<{ order: string[]; offsets: number[] }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);

  const order: string[] = [];
  const offsets: number[] = [];
  const type = (at: number) => String.fromCharCode(...bytes.subarray(at + 4, at + 8));

  const walk = (start: number, end: number, top: boolean) => {
    let at = start;
    while (at + 8 <= end) {
      const size = view.getUint32(at);
      const name = type(at);
      if (top) order.push(name);
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(name)) {
        walk(at + 8, at + size, false);
      } else if (name === "stco" || name === "co64") {
        const wide = name === "co64";
        const count = view.getUint32(at + 12);
        for (let i = 0; i < count; i += 1) {
          const p = at + 16 + i * (wide ? 8 : 4);
          offsets.push(wide ? view.getUint32(p) * 2 ** 32 + view.getUint32(p + 4) : view.getUint32(p));
        }
      }
      if (size < 8) break;
      at += size;
    }
  };

  walk(0, bytes.byteLength, true);
  return { order, offsets };
}

describe("mp4Faststart", () => {
  it("moves the index in front of the frames", async () => {
    const { file } = buildCameraMp4({ mdatBytes: 4096, chunkCount: 4 });
    const result = await mp4Faststart(file);
    expect(result).not.toBeNull();

    const { order } = await readOffsets(result!.blob);
    expect(order).toEqual(["ftyp", "moov", "mdat"]);
  });

  it("keeps every chunk offset pointing at the same bytes", async () => {
    // The assertion that matters. An offset that survives the reorder but lands one
    // byte out produces a file that looks fine and plays as garbage.
    const built = buildCameraMp4({ mdatBytes: 8192, chunkCount: 6 });
    const result = await mp4Faststart(built.file);
    expect(result).not.toBeNull();

    const rewritten = new Uint8Array(await result!.blob.arrayBuffer());
    const view = new DataView(rewritten.buffer);
    const { offsets } = await readOffsets(result!.blob);

    expect(offsets).toHaveLength(built.markers.length);
    offsets.forEach((offset, i) => {
      expect(view.getUint32(offset)).toBe(built.markers[i]);
    });
  });

  it("does the same for 64-bit offset tables", async () => {
    const built = buildCameraMp4({ mdatBytes: 8192, chunkCount: 3, wide: true });
    const result = await mp4Faststart(built.file);
    expect(result).not.toBeNull();

    const rewritten = new Uint8Array(await result!.blob.arrayBuffer());
    const view = new DataView(rewritten.buffer);
    const { offsets } = await readOffsets(result!.blob);
    offsets.forEach((offset, i) => {
      expect(view.getUint32(offset)).toBe(built.markers[i]);
    });
  });

  it("carries the frame data across byte for byte", async () => {
    const built = buildCameraMp4({ mdatBytes: 65536, chunkCount: 8 });
    const result = await mp4Faststart(built.file);
    expect(result!.blob.size).toBe(built.file.size);

    const before = new Uint8Array(await built.file.arrayBuffer());
    const after = new Uint8Array(await result!.blob.arrayBuffer());

    // Find mdat in each file and compare its payload. The index is rewritten by
    // design; the frames must not be touched at all.
    const findMdat = (bytes: Uint8Array) => {
      const view = new DataView(bytes.buffer);
      let at = 0;
      while (at + 8 <= bytes.byteLength) {
        const size = view.getUint32(at);
        const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
        if (name === "mdat") return { start: at + 8, end: at + size };
        at += size;
      }
      throw new Error("no mdat");
    };

    const a = findMdat(before);
    const b = findMdat(after);
    expect(b.end - b.start).toBe(a.end - a.start);
    expect(after.subarray(b.start, b.end)).toEqual(before.subarray(a.start, a.end));

    // And ftyp still opens the file, because players identify the container by it.
    expect(String.fromCharCode(...after.subarray(4, 8))).toBe("ftyp");
  });

  it("leaves a file that is already fast alone", async () => {
    const ftyp = box("ftyp", enc.encode("isom"));
    const stbl = box("stbl", stco([100]));
    const moov = box("moov", box("trak", box("mdia", box("minf", stbl))));
    const mdat = box("mdat", new Uint8Array(1024));
    // Nothing to gain from rewriting, and every rewrite is a risk.
    expect(await mp4Faststart(new Blob([ftyp, moov, mdat]))).toBeNull();
  });

  it("refuses a fragmented file", async () => {
    const ftyp = box("ftyp", enc.encode("isom"));
    const mdat = box("mdat", new Uint8Array(64));
    const moov = box("moov", box("mvex", u32(0)), box("trak", box("mdia", box("minf", box("stbl", stco([40]))))));
    // Fragmented files keep their offsets inside each fragment; this transform does
    // not describe them, and they already start quickly.
    expect(await mp4Faststart(new Blob([ftyp, mdat, moov, box("moof", u32(0))]))).toBeNull();
  });

  it("refuses anything that is not a clean box sequence", async () => {
    expect(await mp4Faststart(new Blob([new Uint8Array(64)]))).toBeNull();
    expect(await mp4Faststart(new Blob([enc.encode("not an mp4 at all")]))).toBeNull();
    expect(await mp4Faststart(new Blob([]))).toBeNull();
  });

  it("refuses a file with no index", async () => {
    const ftyp = box("ftyp", enc.encode("isom"));
    expect(await mp4Faststart(new Blob([ftyp, box("mdat", new Uint8Array(32))]))).toBeNull();
  });

  it("refuses a truncated offset table rather than writing past it", async () => {
    const ftyp = box("ftyp", enc.encode("isom"));
    const mdat = box("mdat", new Uint8Array(256));
    // Claims four entries and carries one.
    const broken = box("stco", u32(0), u32(4), u32(40));
    const moov = box("moov", box("trak", box("mdia", box("minf", box("stbl", broken)))));
    expect(await mp4Faststart(new Blob([ftyp, mdat, moov]))).toBeNull();
  });

  it("refuses an offset that would land outside the file", async () => {
    const ftyp = box("ftyp", enc.encode("isom"));
    const mdat = box("mdat", new Uint8Array(64));
    const moov = box("moov", box("trak", box("mdia", box("minf", box("stbl", stco([9_000_000]))))));
    expect(await mp4Faststart(new Blob([ftyp, mdat, moov]))).toBeNull();
  });

  it("is idempotent — a rewritten file is left alone the second time", async () => {
    const { file } = buildCameraMp4({ mdatBytes: 4096, chunkCount: 3 });
    const once = await mp4Faststart(file);
    expect(await mp4Faststart(once!.blob)).toBeNull();
  });
});

describe("looksLikeMp4", () => {
  it("recognises the containers this applies to", () => {
    expect(looksLikeMp4("a.mp4", "video/mp4")).toBe(true);
    expect(looksLikeMp4("GX011596.MP4", undefined)).toBe(true);
    expect(looksLikeMp4("clip.mov", "video/quicktime")).toBe(true);
    expect(looksLikeMp4("clip.m4v", "")).toBe(true);
  });

  it("leaves everything else out", () => {
    expect(looksLikeMp4("a.mkv", "video/x-matroska")).toBe(false);
    expect(looksLikeMp4("a.webm", "video/webm")).toBe(false);
    expect(looksLikeMp4("photo.png", "image/png")).toBe(false);
  });
});
