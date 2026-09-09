// How an upload is cut into parts.
//
// Shared rather than server-only: the server decides these numbers and puts them in
// the upload ticket, but the browser slices the file by them. Two copies that drift
// mean a part boundary the server did not expect, which storage rejects with nothing
// useful to say.
//
// ---------------------------------------------------------------------------
// Measured, not assumed
// ---------------------------------------------------------------------------
//
// 64 MB to the live bucket, two rounds, interleaved so network drift hit every arm
// equally:
//
//     one PUT                2.83 MB/s
//     2 x 32 MB, 1 at a time 2.39 MB/s
//     2 x 32 MB, 2 at once   2.18 MB/s
//     8 x  8 MB, 4 at once   2.12 MB/s   <- what this file used to say
//     4 x 16 MB, 2 at once   1.88 MB/s
//
// and at 24 MB, one PUT beat four parallel parts by 1.8x across three rounds.
//
// So the previous settings were making uploads slower. The reasoning behind them —
// "parallel parts are how you fill a pipe" — is true of a link whose limit is latency,
// and false of a consumer uplink, where the limit is bandwidth. There, four
// connections do not multiply the throughput; they divide it, and each one separately
// pays a TLS handshake and a TCP slow start before it gets going.
//
// Hence: send as few, and as long, a request as the file allows.
//
// The counterweight is resumability. A single PUT of 3 GB is one connection that
// either finishes or loses everything, and mobile connections drop. So splitting is
// still what large files get — just in big pieces rather than many small ones.

/** S3 allows at most this many parts per object. */
export const MULTIPART_MAX_PARTS = 10_000;

/** The smallest a part may be, except the last one. An S3 rule, not a choice. */
export const MULTIPART_MIN_PART_SIZE = 5 * 1024 * 1024;

/**
 * The part size a split upload uses.
 *
 * Large, because the measurements above say the cost is per-request rather than
 * per-byte. It was 8 MB, which turned a 263 MB video into 33 separate handshakes.
 *
 * A failed part costs re-sending this much, which at the speeds above is a dozen
 * seconds — the price of resumability, and a fair one.
 */
export const MULTIPART_PART_SIZE = 32 * 1024 * 1024;

/**
 * How many parts are in flight at once.
 *
 * Two rather than four. One is marginally faster still, but two means a stalled part
 * does not stop the upload dead, and the difference between them was inside the
 * run-to-run spread.
 */
export const UPLOAD_PART_CONCURRENCY = 2;

/**
 * Above this size an upload is split.
 *
 * Below it a single PUT is both faster and simpler, and a failure costs one retry of
 * a file small enough to retry. Above it, one dropped connection would throw away too
 * much work to accept.
 *
 * 96 MB puts almost everything anyone uploads — photos, documents, short clips — on
 * the fast path, while the long videos that actually need resuming still get it.
 */
export const MULTIPART_THRESHOLD = 96 * 1024 * 1024;

/**
 * The part size for an upload of this size.
 *
 * The standard size, unless the object is so large that using it would exceed the
 * 10,000-part limit — a fixed 32 MB part caps an object at 320 GB, so beyond that the
 * parts grow instead of the upload being refused.
 */
export function partSizeFor(sizeBytes: number): number {
  return Math.max(MULTIPART_PART_SIZE, Math.ceil(sizeBytes / MULTIPART_MAX_PARTS));
}
