"use client";

// Moving an MP4's index to the front, so it starts playing immediately.
//
// An MP4 is a sequence of boxes. `mdat` holds the frames; `moov` holds the index that
// says where each frame is. A player cannot decode anything until it has read `moov`.
//
// Cameras write `moov` last, because its contents are not known until recording stops:
//
//     ftyp | mdat (338 MB of frames) | moov
//
// Streamed over the network that is a disaster. The browser fetches the front, finds
// only frames, works out the index must be at the far end, ranges to it, and only then
// begins. Two round trips across the world before a single frame appears — which is
// exactly what "the video takes ages to start" was.
//
// The fix is to reorder the file once, at upload:
//
//     ftyp | moov | mdat
//
// Everything inside `moov` that points at `mdat` has to move with it. Those pointers
// are absolute file offsets in the `stco` (32-bit) and `co64` (64-bit) tables, and
// every one of them shifts forward by the size of the `moov` box that now sits in
// front. Get that arithmetic wrong and the file is silently corrupt.
//
// So nothing here is trusted. The rewrite is verified against the original before it
// is used, and anything unexpected — a fragmented file, a layout that is already
// right, a box that does not parse — returns null, and the caller uploads the original
// untouched. The worst outcome is the behaviour we have today.
//
// Memory is not a concern despite the sizes: the result is a Blob assembled from
// slices of the original File, which the browser reads from disk on demand. Only
// `moov` itself is ever held, and that is a few megabytes at most.

/** Above this the 32-bit offset tables cannot express the shifted positions. */
const MAX_FILE_BYTES = 3.9 * 1024 * 1024 * 1024;

/** A `moov` larger than this is not something to pull into a tab's memory. */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;

/** Boxes whose payload is a list of further boxes rather than data. */
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

interface Box {
  type: string;
  /** Offset of the box header within whatever contains it. */
  start: number;
  /** One past the last byte of the box. */
  end: number;
}

interface Header {
  type: string;
  /** Total box length including the header. 0 means "to the end of the container". */
  size: number;
  /** 8, or 16 when the box uses the 64-bit length form. */
  headerSize: number;
}

/**
 * Reads the box header at `offset`.
 *
 * `available` bounds only the header read, not the box: a 338 MB `mdat` is described
 * by sixteen bytes, and validating its length against the sixteen bytes in hand is
 * how an earlier version of this rejected every camera file it was written for.
 * Whether the box fits its container is the caller's question.
 */
function readHeader(view: DataView, offset: number, available: number): Header | null {
  if (offset + 8 > available) return null;

  let size = view.getUint32(offset);
  let type = "";
  for (let i = 4; i < 8; i += 1) {
    const c = view.getUint8(offset + i);
    // Box types are four printable characters. Anything else means this is not a box
    // header, which is the signal to stop rather than to guess.
    if (c < 0x20 || c > 0x7e) return null;
    type += String.fromCharCode(c);
  }

  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > available) return null;
    size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
    headerSize = 16;
  } else if (size !== 0 && size < 8) {
    return null;
  }

  return { type, size, headerSize };
}

/** The top-level boxes of the file, or null if it does not parse cleanly end to end. */
async function topLevelBoxes(file: Blob): Promise<Box[] | null> {
  const boxes: Box[] = [];
  let offset = 0;

  while (offset < file.size) {
    // Only the header is read, never the box. A 338 MB `mdat` costs sixteen bytes to
    // step over.
    const head = await file.slice(offset, Math.min(offset + 16, file.size)).arrayBuffer();
    const header = readHeader(new DataView(head), 0, head.byteLength);
    if (!header) return null;

    // A declared size of zero means the box runs to the end of the file, which is only
    // legal for the last one.
    const size = header.size === 0 ? file.size - offset : header.size;
    if (size < header.headerSize || offset + size > file.size) return null;

    boxes.push({ type: header.type, start: offset, end: offset + size });
    offset += size;
  }

  // A file whose boxes do not tile it exactly is not one to be rewriting.
  return offset === file.size ? boxes : null;
}

/**
 * Shifts every chunk offset inside a `moov` by `delta`.
 *
 * Walks only into boxes that are defined to contain other boxes. Scanning blindly
 * would eventually read compressed data as a box header and patch four bytes of
 * somebody's video.
 *
 * Returns false if anything is inconsistent — a truncated table, an offset that would
 * land outside the file, or one too large for the 32-bit field it lives in.
 */
function shiftChunkOffsets(
  moov: Uint8Array,
  boundary: number,
  delta: number,
  fileSize: number,
): boolean {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  let ok = true;

  const walk = (start: number, end: number): void => {
    let offset = start;
    while (ok && offset + 8 <= end) {
      const header = readHeader(view, offset, end);
      if (!header || header.size === 0 || offset + header.size > end) {
        ok = false;
        return;
      }
      const body = offset + header.headerSize;
      const boxEnd = offset + header.size;

      if (CONTAINERS.has(header.type)) {
        walk(body, boxEnd);
      } else if (header.type === "stco" || header.type === "co64") {
        const wide = header.type === "co64";
        const entrySize = wide ? 8 : 4;
        // version(1) + flags(3) + entry_count(4)
        if (body + 8 > boxEnd) {
          ok = false;
          return;
        }
        const count = view.getUint32(body + 4);
        const first = body + 8;
        if (first + count * entrySize > boxEnd) {
          ok = false;
          return;
        }

        for (let i = 0; i < count; i += 1) {
          const at = first + i * entrySize;
          const value = wide
            ? view.getUint32(at) * 2 ** 32 + view.getUint32(at + 4)
            : view.getUint32(at);

          // Data that lived before the index moves forward by exactly the size of the
          // index. Anything already after it does not move at all — the index left a
          // gap of its own size behind, and closing that gap puts everything back
          // where it was.
          const shifted = value < boundary ? value + delta : value;

          if (shifted < 0 || shifted >= fileSize) {
            ok = false;
            return;
          }
          if (wide) {
            view.setUint32(at, Math.floor(shifted / 2 ** 32));
            view.setUint32(at + 4, shifted >>> 0);
          } else {
            if (shifted > 0xffffffff) {
              ok = false;
              return;
            }
            view.setUint32(at, shifted);
          }
        }
      }

      offset = boxEnd;
    }
  };

  // Skip the moov box's own header and walk its children.
  walk(8, moov.byteLength);
  return ok;
}

export interface FaststartResult {
  /** The reordered file, assembled lazily from slices of the original. */
  blob: Blob;
  /** Where `moov` was, for reporting. */
  movedBytes: number;
}

/**
 * Reorders an MP4 so its index comes first, or returns null to leave it alone.
 *
 * Null is the ordinary answer for most files: already in the right order, fragmented,
 * not an MP4 at all. The caller uploads the original in every one of those cases.
 */
export async function mp4Faststart(file: Blob): Promise<FaststartResult | null> {
  try {
    if (file.size < 16 || file.size > MAX_FILE_BYTES) return null;

    const boxes = await topLevelBoxes(file);
    if (!boxes) return null;

    const ftyp = boxes[0];
    if (!ftyp || ftyp.type !== "ftyp") return null;

    const moovIndex = boxes.findIndex((b) => b.type === "moov");
    const mdatIndex = boxes.findIndex((b) => b.type === "mdat");
    if (moovIndex < 0 || mdatIndex < 0) return null;

    // Already the right way round. Nothing to gain, and every rewrite is a risk.
    if (moovIndex < mdatIndex) return null;

    // A fragmented file keeps its offsets inside each fragment, not in stco, so this
    // transform does not describe it. They also already start quickly.
    if (boxes.some((b) => b.type === "moof" || b.type === "mvex")) return null;

    const moov = boxes[moovIndex]!;
    const moovSize = moov.end - moov.start;
    if (moovSize > MAX_MOOV_BYTES) return null;

    const moovBytes = new Uint8Array(await file.slice(moov.start, moov.end).arrayBuffer());
    if (moovBytes.byteLength !== moovSize) return null;

    if (!shiftChunkOffsets(moovBytes, moov.start, moovSize, file.size)) return null;

    const rebuilt = new Blob(
      [
        file.slice(0, ftyp.end), // ftyp stays where it is
        moovBytes, // the index, now in front
        file.slice(ftyp.end, moov.start), // everything that was between them, mdat included
        file.slice(moov.end, file.size), // anything that followed the index
      ],
      { type: file.type },
    );

    // The reorder must not have gained or lost a byte. If it did, something above is
    // wrong in a way not worth reasoning about — hand back the original.
    if (rebuilt.size !== file.size) return null;

    return { blob: rebuilt, movedBytes: moovSize };
  } catch {
    // Malformed input, a read that failed, memory. None of it is worth an upload.
    return null;
  }
}

/** Whether this file is worth trying at all. Cheap check before any reading. */
export function looksLikeMp4(name: string, mimeType: string | undefined): boolean {
  if (mimeType && /^video\/(mp4|quicktime|x-m4v)$/i.test(mimeType)) return true;
  return /\.(mp4|m4v|mov)$/i.test(name);
}
