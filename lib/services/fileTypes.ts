// What a file is, and how it may be served.
//
// Pure functions, no server-only guard: the browser needs the same answers the
// server does — which extension a file has, whether it can be opened in a text
// editor — and duplicating the tables is how the two ends drift apart. The server
// imports this through lib/services/mime, which keeps the guard.
//
// This used to refuse uploads it did not like: .html, .htm, .svg, anything
// executable, and every extension it had never heard of. That is the wrong control
// for a storage product. People keep .html exports, .js files, installers and
// archives in cloud storage, and refusing them makes the product useless for the
// files somebody actually has — while the thing being defended against is not
// storage at all.
//
// The risk was never holding the bytes. It is a browser *rendering* them: an .html
// or .svg opened inline can run script, and a page that looks like a login form on a
// domain the visitor half-trusts is a good phishing page. So the control moved to
// where the risk is. Everything can be stored; what cannot happen is a file being
// served inline when rendering it would run something.
//
// Note also that our files are served from object storage's own origin through
// presigned URLs, never from cloudcols.com — so even a rendered file cannot reach a
// CloudCols session. Forcing a download is defence for the person clicking the link.

/** Canonical MIME for a known extension. The server's answer beats the client's claim. */
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", heic: "image/heic", heif: "image/heif", avif: "image/avif", bmp: "image/bmp",
  ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff",

  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  m4v: "video/x-m4v", avi: "video/x-msvideo", wmv: "video/x-ms-wmv", flv: "video/x-flv",
  "3gp": "video/3gpp", mpeg: "video/mpeg", mpg: "video/mpeg",

  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  aac: "audio/aac", opus: "audio/opus", wma: "audio/x-ms-wma", aiff: "audio/aiff",

  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf", epub: "application/epub+zip",

  txt: "text/plain", md: "text/markdown", markdown: "text/markdown", csv: "text/csv",
  tsv: "text/tab-separated-values", log: "text/plain", json: "application/json",
  xml: "application/xml", yml: "text/yaml", yaml: "text/yaml", toml: "text/plain",
  ini: "text/plain", conf: "text/plain", env: "text/plain", sql: "text/plain",
  html: "text/html", htm: "text/html", xhtml: "application/xhtml+xml", css: "text/css",
  js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript", ts: "text/plain",
  tsx: "text/plain", jsx: "text/plain", py: "text/plain", rb: "text/plain", go: "text/plain",
  rs: "text/plain", java: "text/plain", c: "text/plain", h: "text/plain", cpp: "text/plain",
  sh: "text/plain", bat: "text/plain", ps1: "text/plain", dart: "text/plain", php: "text/plain",

  zip: "application/zip", gz: "application/gzip", tgz: "application/gzip",
  tar: "application/x-tar", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  bz2: "application/x-bzip2", xz: "application/x-xz",
};

/**
 * Types a browser will execute or render as a document if handed them inline.
 *
 * These are still stored and still downloadable — they are simply never served with
 * an inline disposition, so clicking one saves it instead of running it.
 *
 * SVG is on the list because it is not just a picture: it can carry <script>.
 */
const NEVER_INLINE_EXT = new Set([
  "html", "htm", "xhtml", "shtml", "phtml", "mhtml", "mht", "svg", "xml", "xsl", "xslt",
  "js", "mjs", "cjs", "php", "jsp", "asp", "aspx", "swf",
]);

const NEVER_INLINE_MIME = new Set([
  "text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/xml",
  "text/javascript", "application/javascript", "application/x-shockwave-flash",
]);

export function extensionOf(filename: string): string {
  const name = filename.trim();
  // `split(".").pop()` on a name with no dot returns the whole name, so "Makefile"
  // came back with the extension "makefile" — and a file simply called "html" would
  // have been treated as markup. A name with no dot has no extension.
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface MimeResult {
  allowed: boolean;
  reason?: string;
  effectiveMime: string;
}

/**
 * The canonical MIME for a stored file.
 *
 * Nothing is refused. The result keeps the `allowed` shape its callers already
 * check, so the upload path did not have to change to stop rejecting things — but
 * it is always true now, and the reason field is unused.
 *
 * The extension decides when we know it. A client's claimed type is only used for an
 * extension we have never seen, and even then only if it looks like a MIME type at
 * all; otherwise the file is an opaque blob, which is a perfectly good thing for a
 * storage product to hold.
 */
export function validateMime(filename: string, reportedMime?: string | null): MimeResult {
  const ext = extensionOf(filename);
  const known = EXT_MIME[ext];
  if (known) return { allowed: true, effectiveMime: known };

  const reported = (reportedMime ?? "").toLowerCase().split(";")[0]!.trim();
  if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(reported)) {
    return { allowed: true, effectiveMime: reported };
  }
  return { allowed: true, effectiveMime: "application/octet-stream" };
}

/**
 * Whether serving this file inline would let a browser run it.
 *
 * Checked against both the filename and the stored MIME, because either alone can be
 * talked around: a file called `report.pdf` stored as text/html, or one called
 * `page.html` stored as octet-stream.
 */
export function mustDownload(filename: string, mime?: string | null): boolean {
  if (NEVER_INLINE_EXT.has(extensionOf(filename))) return true;
  const type = (mime ?? "").toLowerCase().split(";")[0]!.trim();
  return NEVER_INLINE_MIME.has(type);
}

/**
 * Whether the file is text a person can read and edit in the browser.
 *
 * Binary document formats — .doc, .docx, .xlsx, .pdf — are deliberately not here.
 * They are not text, and opening one in a text editor would show a wall of bytes and
 * offer to save it back corrupted.
 */
const TEXT_EXT = new Set([
  "txt", "md", "markdown", "csv", "tsv", "log", "json", "xml", "yml", "yaml", "toml",
  "ini", "conf", "env", "sql", "html", "htm", "xhtml", "css", "js", "mjs", "cjs",
  "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "sh", "bat",
  "ps1", "dart", "php", "svg", "rtf",
]);

export function isTextEditable(filename: string, mime?: string | null): boolean {
  if (TEXT_EXT.has(extensionOf(filename))) return true;
  const type = (mime ?? "").toLowerCase();
  return type.startsWith("text/") || type === "application/json" || type === "application/xml";
}

/** The biggest file worth opening in a text editor. */
export const TEXT_EDIT_MAX_BYTES = 2 * 1024 * 1024;
