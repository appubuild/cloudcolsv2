// Server-side MIME + extension validation for uploads (security control).
// The scanner trusts only server-derived values: the MIME type recorded at
// upload-ticket time (from an allow-list) and the sanitized extension. We reject
// obvious executable/script disguises and unknown/unsafe types rather than
// guessing. Category derivation is done separately (lib/storage/categories).

import "server-only";

const EXT_ALLOW: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", heic: "image/heic", avif: "image/avif",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", m4v: "video/x-m4v",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  pdf: "application/pdf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", md: "text/markdown", json: "application/json", xml: "application/xml",
  zip: "application/zip", gz: "application/gzip", tar: "application/x-tar", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  // images as assets are allowed; executables/disguises are not
};

// Extensions we will NEVER accept (executables, scripts, binaries).
export const EXT_BLOCK = new Set([
  "exe", "bat", "cmd", "com", "scr", "msi", "js", "mjs", "ts", "sh", "ps1", "vbs", "cpl", "jar", "apk",
  "dll", "so", "php", "html", "htm", "xhtml", "phtml", "swf", "elf", "wasm", "dmg", "pkg",
]);

export interface MimeResult {
  allowed: boolean;
  reason?: string;
  effectiveMime: string;
}

/**
 * Validate a filename + reported MIME. Returns the server-canonical MIME if
 * allowed, else a reason (throws the caller's ApiError). Used at upload-confirm.
 */
export function validateMime(filename: string, reportedMime?: string | null): MimeResult {
  const name = filename.trim();
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (!ext) return { allowed: false, reason: "File has no extension.", effectiveMime: "" };
  if (EXT_BLOCK.has(ext)) return { allowed: false, reason: `File type .${ext} is not allowed.`, effectiveMime: "" };

  const expected = EXT_ALLOW[ext];
  const reported = (reportedMime ?? "").toLowerCase();

  // If the extension is in the allow-list, use the expected MIME for that ext as
  // the canonical type (server-authoritative), ignoring a mismatched claim.
  if (expected) return { allowed: true, effectiveMime: expected };

  // Unknown extension: fall back to a document/other octet-stream only if the
  // claimed MIME is a benign text/application type.
  if (reported.startsWith("text/") || reported === "application/pdf") {
    return { allowed: true, effectiveMime: reported };
  }
  return { allowed: false, reason: `Unsupported file type (.${ext}).`, effectiveMime: "" };
}
