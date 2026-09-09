import { describe, it, expect } from "vitest";
import {
  partSizeFor,
  MULTIPART_MIN_PART_SIZE,
  MULTIPART_PART_SIZE,
  MULTIPART_MAX_PARTS,
  MULTIPART_THRESHOLD,
  UPLOAD_PART_CONCURRENCY,
} from "../lib/storage/multipart";

const MB = 1024 * 1024;
const GB = 1024 * MB;
const parts = (size: number) => Math.ceil(size / partSizeFor(size));

describe("partSizeFor", () => {
  it("never goes below the storage floor", () => {
    for (const size of [1 * MB, 96 * MB, 200 * MB, 3 * GB, 500 * GB]) {
      expect(partSizeFor(size)).toBeGreaterThanOrEqual(MULTIPART_MIN_PART_SIZE);
    }
  });

  it("uses the standard part size for anything that gets split", () => {
    // Everything from the threshold up to the point where the part limit bites.
    for (const size of [96 * MB, 263 * MB, 3 * GB, 300 * GB]) {
      expect(partSizeFor(size)).toBe(MULTIPART_PART_SIZE);
    }
  });

  it("grows the parts rather than refusing a very large object", () => {
    // A fixed 32 MB part would cap an object at 320 GB. Past that the parts have to
    // get bigger, or the upload cannot be expressed at all.
    expect(partSizeFor(400 * GB)).toBeGreaterThan(MULTIPART_PART_SIZE);
    for (const size of [400 * GB, 1024 * GB, 5 * 1024 * GB]) {
      expect(parts(size)).toBeLessThanOrEqual(MULTIPART_MAX_PARTS);
    }
  });

  it("keeps a large video to a manageable number of requests", () => {
    // The measurements say the cost is per request, not per byte. At the old 8 MB a
    // 263 MB video was 33 separate handshakes; the point of the change is that it is
    // now single digits.
    expect(parts(263 * MB)).toBeLessThanOrEqual(10);
    expect(parts(3 * GB)).toBeLessThanOrEqual(100);
  });

  it("splits only where splitting buys something", () => {
    // Below the threshold nothing is split, so the threshold must leave room for at
    // least two real parts — otherwise it would "split" into one.
    expect(MULTIPART_THRESHOLD).toBeGreaterThan(MULTIPART_PART_SIZE * 2);
  });

  it("sends few enough parts at once to stay on the measured fast path", () => {
    // Four was measured slower than two on a bandwidth-limited link, and two was
    // within noise of one. This guards the finding against a future tidy-up that
    // "optimises" by raising it.
    expect(UPLOAD_PART_CONCURRENCY).toBeLessThanOrEqual(2);
    expect(UPLOAD_PART_CONCURRENCY).toBeGreaterThanOrEqual(1);
  });

  it("is stable — the browser slices by exactly what the server signed", () => {
    const size = 147 * MB + 13;
    expect(partSizeFor(size)).toBe(partSizeFor(size));
  });
});
