// Backblaze B2 integration via the S3-compatible API.
//
// Signing is done with Web Crypto (lib/services/sigv4.ts) rather than the AWS SDK.
// The SDK is built for Node: it pulls in a large dependency tree and reaches for Node
// built-ins that the Cloudflare Workers runtime does not provide natively, which makes
// it the wrong tool for a Worker deployment. The signer here is the same code that is
// tested against live Backblaze, and it is provider-neutral — the same requests sign
// for B2, R2, S3 or MinIO.
//
// The client receives short-lived presigned URLs and uploads/downloads bytes DIRECTLY
// to B2. The application server never proxies large files.

import "server-only";
import { presignUrl, signRequest, type SigV4Config } from "./sigv4";
import type { PresignRequest } from "./types";
import { serverEnv } from "@/lib/config/server-env";

function config(): { sig: SigV4Config; endpoint: string; bucket: string } {
  if (!serverEnv.b2.endpoint || !serverEnv.b2.bucket) {
    throw new Error("B2_ENDPOINT / B2_BUCKET are not configured.");
  }
  if (!serverEnv.b2.accessKeyId || !serverEnv.b2.secretAccessKey) {
    throw new Error("B2_ACCESS_KEY_ID / B2_SECRET_ACCESS_KEY are not configured.");
  }
  return {
    sig: {
      accessKeyId: serverEnv.b2.accessKeyId,
      secretAccessKey: serverEnv.b2.secretAccessKey,
      region: serverEnv.b2.region,
    },
    endpoint: serverEnv.b2.endpoint,
    bucket: serverEnv.b2.bucket,
  };
}

/** Origin with a scheme, whether or not B2_ENDPOINT was given with one. */
function originOf(endpoint: string): string {
  return endpoint.startsWith("http") ? endpoint : `https://${endpoint}`;
}

/** Path-style object URL, with each path segment encoded but the separators kept. */
function objectUrl(endpoint: string, bucket: string, objectKey: string): string {
  const encoded = objectKey.split("/").map(encodeURIComponent).join("/");
  return `${originOf(endpoint)}/${bucket}/${encoded}`;
}

/** Issue a short-lived presigned PUT URL so the client uploads directly to B2. */
// contentType is accepted for call-site compatibility but deliberately NOT bound into
// the signature: the browser sets its own Content-Type on the upload, and a mismatch
// with the signed value makes B2 reject the request. The stored type is recorded from
// the ticket and reconciled server-side at confirm, so nothing is lost.
export async function getPresignedUploadUrl({
  objectKey,
  expiresIn = 900, // 15 minutes
}: PresignRequest): Promise<{ presignedUrl: string; expiresIn: number }> {
  const { sig, endpoint, bucket } = config();
  const presignedUrl = await presignUrl(sig, {
    method: "PUT",
    endpoint,
    bucket,
    key: objectKey,
    expiresIn,
  });
  return { presignedUrl, expiresIn };
}

/**
 * Verify a stored object exists and return its size (used at upload-confirm).
 *
 * Returns null when the object is genuinely absent. A HEAD carries no response body,
 * and runtimes disagree about such requests, so a failed HEAD is retried as a one-byte
 * ranged GET before the object is declared missing — otherwise a runtime quirk silently
 * discards a file the user successfully uploaded.
 */
export async function headObject(
  objectKey: string
): Promise<{ sizeBytes: number; contentType?: string } | null> {
  const { sig, endpoint, bucket } = config();
  const path = `/${bucket}/${objectKey}`;
  const url = objectUrl(endpoint, bucket, objectKey);

  try {
    const headers = await signRequest(sig, { method: "HEAD", endpoint, path });
    const res = await fetch(url, { method: "HEAD", headers });

    if (res.status === 404) return null;
    if (res.ok) {
      return {
        sizeBytes: Number(res.headers.get("content-length") ?? 0),
        contentType: res.headers.get("content-type") ?? undefined,
      };
    }
  } catch {
    // Fall through to the ranged GET.
  }

  return headByRange(objectKey);
}

/** Second, independent way to confirm an object: `Range: bytes=0-0`. */
async function headByRange(
  objectKey: string
): Promise<{ sizeBytes: number; contentType?: string } | null> {
  const { sig, endpoint, bucket } = config();
  const path = `/${bucket}/${objectKey}`;

  try {
    const headers = await signRequest(sig, { method: "GET", endpoint, path });
    // Range is added after signing: it is not among the signed headers, so binding it
    // into the signature would make B2 reject the request.
    const res = await fetch(objectUrl(endpoint, bucket, objectKey), {
      method: "GET",
      headers: { ...headers, Range: "bytes=0-0" },
    });

    if (res.status === 404) return null;
    // 206 is expected; 200 means the range was ignored and the whole object came back,
    // which still answers the question.
    if (res.status !== 206 && res.status !== 200) return null;

    // "bytes 0-0/705306" — the total after the slash is the real size.
    const total = res.headers.get("content-range")?.split("/")[1];
    const sizeBytes =
      total && /^\d+$/.test(total) ? Number(total) : Number(res.headers.get("content-length") ?? 0);

    return { sizeBytes, contentType: res.headers.get("content-type") ?? undefined };
  } catch {
    return null;
  }
}

/** Issue a short-lived presigned GET URL for download/streaming. */
export async function getPresignedDownloadUrl(
  objectKey: string,
  expiresIn = 600, // 10 minutes
  opts: { downloadFilename?: string; contentType?: string } = {}
): Promise<{ presignedUrl: string; expiresIn: number }> {
  const { sig, endpoint, bucket } = config();

  const query: Record<string, string> = {};
  // Lets the browser save under the user's original filename while the stored object
  // keeps its generated key. The value is bound into the signature, so whoever holds
  // the URL cannot alter it.
  if (opts.downloadFilename) {
    const safe = opts.downloadFilename.replace(/["\\\r\n]/g, "_");
    query["response-content-disposition"] =
      `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadFilename)}; filename="${safe}"`;
  }
  if (opts.contentType) query["response-content-type"] = opts.contentType;

  const presignedUrl = await presignUrl(sig, {
    method: "GET",
    endpoint,
    bucket,
    key: objectKey,
    expiresIn,
    ...(Object.keys(query).length ? { query } : {}),
  });
  return { presignedUrl, expiresIn };
}

/** Delete an object permanently (used on permanent delete / account delete). */
export async function deleteObject(objectKey: string): Promise<void> {
  try {
    const { sig, endpoint, bucket } = config();
    const headers = await signRequest(sig, { method: "DELETE", endpoint, path: `/${bucket}/${objectKey}` });
    const res = await fetch(objectUrl(endpoint, bucket, objectKey), { method: "DELETE", headers });
    // 404 is success here: the object is gone either way.
    if (!res.ok && res.status !== 404) {
      console.error("[b2] deleteObject failed", objectKey, res.status);
    }
  } catch (e) {
    // Non-fatal: a storage failure must not block the row from being removed.
    console.error("[b2] deleteObject failed", objectKey, (e as Error).message);
  }
}

/** Undo the five entities XML escapes. Keys are user-influenced; `&` in one is real. */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Up to `max` object keys under `prefix` (one page; storage caps a page at 1000).
 *
 * One page on purpose. The caller deletes what it gets and asks again, so a listing
 * never has to be held while its objects disappear underneath it, and a job can stop
 * at its budget without having listed work it will not do.
 */
export async function listObjects(prefix: string, max = 1000): Promise<string[]> {
  const { sig, endpoint, bucket } = config();
  const query: Record<string, string> = {
    "list-type": "2",
    prefix,
    "max-keys": String(Math.max(1, Math.min(1000, Math.floor(max)))),
  };
  const headers = await signRequest(sig, { method: "GET", endpoint, path: `/${bucket}`, query });
  const search = new URLSearchParams(query).toString();
  const res = await fetch(`${originOf(endpoint)}/${bucket}?${search}`, { headers });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Storage refused to list objects (HTTP ${res.status}). ${body.slice(0, 200)}`);
  }
  const keys: string[] = [];
  for (const chunk of body.split("<Contents>").slice(1)) {
    const key = xmlTag(chunk.split("</Contents>")[0] ?? "", "Key");
    if (key) keys.push(unescapeXml(key));
  }
  return keys;
}

/**
 * The bucket's top-level "folders" — one per account, since every key is
 * "<user id>/...". Used to find folders whose account no longer exists.
 *
 * Paginated and bounded: ten pages is ten thousand accounts, and a provider that keeps
 * saying "truncated" without advancing must not loop a cron run forever.
 */
export async function listTopLevelPrefixes(maxPages = 10): Promise<string[]> {
  const { sig, endpoint, bucket } = config();
  const out: string[] = [];
  let token: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const query: Record<string, string> = { "list-type": "2", delimiter: "/" };
    if (token) query["continuation-token"] = token;
    const headers = await signRequest(sig, { method: "GET", endpoint, path: `/${bucket}`, query });
    const search = new URLSearchParams(query).toString();
    const res = await fetch(`${originOf(endpoint)}/${bucket}?${search}`, { headers });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Storage refused to list folders (HTTP ${res.status}). ${body.slice(0, 200)}`);
    }
    for (const chunk of body.split("<CommonPrefixes>").slice(1)) {
      const prefix = xmlTag(chunk.split("</CommonPrefixes>")[0] ?? "", "Prefix");
      if (prefix) out.push(unescapeXml(prefix));
    }
    if (xmlTag(body, "IsTruncated") !== "true") break;
    const next = xmlTag(body, "NextContinuationToken");
    if (!next || unescapeXml(next) === token) break;
    token = unescapeXml(next);
  }

  return out;
}

// `publicUrl()` used to live here: it built an unsigned bucket URL for a key and had
// no callers. Against a private bucket that URL is a guaranteed 403, and having it in
// reach invited exactly the mistake this phase existed to fix — handing a reader a raw
// storage URL instead of a delivery one. Every read now goes through
// lib/services/delivery.ts, which chooses the CDN and falls back to a *signed* URL.

// ---------------------------------------------------------------------------
// Multipart upload
// ---------------------------------------------------------------------------
//
// A single presigned PUT is one HTTP request that either finishes or does not. For a
// 3 GB file — the size this product advertises — that is not a feature: a dropped
// connection at 90% means starting again from zero, and mobile connections drop.
//
// Multipart splits the object into independently uploadable parts. A failed part is
// retried on its own, an interrupted upload resumes from the parts that already
// landed, and the parts go straight from the browser to storage exactly as before.
// Only three small control calls — create, complete, abort — involve our compute, and
// none of them carries file bytes.

// The sizes themselves live in lib/storage/multipart.ts, because the browser slices
// the file by exactly the numbers the server signs for. Re-exported here so callers
// that already talk to storage do not need to know that.
export {
  MULTIPART_PART_SIZE,
  MULTIPART_THRESHOLD,
  MULTIPART_MAX_PARTS,
  MULTIPART_MIN_PART_SIZE,
  UPLOAD_PART_CONCURRENCY,
  partSizeFor,
} from "@/lib/storage/multipart";

/**
 * Pull a single XML tag's text out of a response. Enough for these three calls.
 *
 * Deliberately not a regex. This was built with `new RegExp` from a template literal,
 * where `\s` and `\S` are not escape sequences the literal recognises — so it dropped
 * the backslashes and the character class became `[sS]`, matching only the letters s
 * and S. The pattern compiled, ran, and never matched an upload id. Storage was
 * returning a perfectly good InitiateMultipartUploadResult and every large upload
 * failed with "storage did not return an upload id".
 *
 * Two string searches have no escaping to get wrong.
 */
export function xmlTag(body: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = body.indexOf(open);
  if (start === -1) return null;
  const end = body.indexOf(close, start + open.length);
  if (end === -1) return null;
  return body.slice(start + open.length, end).trim();
}

/** Begin a multipart upload. Returns the id every subsequent call needs. */
export async function createMultipartUpload(
  objectKey: string,
  contentType?: string,
): Promise<{ uploadId: string }> {
  const { sig, endpoint, bucket } = config();
  const path = `/${bucket}/${objectKey}`;
  const query = { uploads: "" };

  const headers = await signRequest(sig, { method: "POST", endpoint, path, query, body: "" });
  const res = await fetch(`${objectUrl(endpoint, bucket, objectKey)}?uploads=`, {
    method: "POST",
    headers: { ...headers, ...(contentType ? { "content-type": contentType } : {}) },
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`Storage refused to start the upload (HTTP ${res.status}). ${body.slice(0, 200)}`);

  const uploadId = xmlTag(body, "UploadId");
  // The body matters when this fails: "no upload id" alone gives nobody anything to
  // work with, and storage explains itself in the XML it just sent.
  if (!uploadId) throw new Error(`Storage did not return an upload id. ${body.slice(0, 300)}`);
  return { uploadId };
}

/**
 * A presigned PUT for one part.
 *
 * Part numbers are 1-based. The number and the upload id are bound into the
 * signature, so a URL for part 3 cannot be replayed as part 4.
 */
export async function presignUploadPart(
  objectKey: string,
  uploadId: string,
  partNumber: number,
  expiresIn = 3600,
): Promise<string> {
  const { sig, endpoint, bucket } = config();
  return presignUrl(sig, {
    method: "PUT",
    endpoint,
    bucket,
    key: objectKey,
    expiresIn,
    query: { partNumber: String(partNumber), uploadId },
  });
}

/**
 * Assemble the parts into the finished object.
 *
 * The parts must be listed in ascending order with the ETag storage returned for
 * each; out of order, S3 rejects the whole thing.
 */
export async function completeMultipartUpload(
  objectKey: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  const { sig, endpoint, bucket } = config();
  const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);

  const body =
    "<CompleteMultipartUpload>" +
    ordered
      .map((p) => {
        // ETags come back quoted, and some clients strip the quotes. Normalise, then
        // quote exactly once — an unquoted ETag is rejected.
        const etag = p.etag.replace(/^"+|"+$/g, "");
        return `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>&quot;${etag}&quot;</ETag></Part>`;
      })
      .join("") +
    "</CompleteMultipartUpload>";

  const path = `/${bucket}/${objectKey}`;
  const query = { uploadId };
  const headers = await signRequest(sig, { method: "POST", endpoint, path, query, body });

  const res = await fetch(`${objectUrl(endpoint, bucket, objectKey)}?uploadId=${encodeURIComponent(uploadId)}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/xml" },
    body,
  });

  const text = await res.text();
  // S3 can answer 200 and still describe a failure in the body, because the response
  // is streamed while the parts are being assembled. Checking only the status here
  // would record a file that was never finished.
  if (!res.ok || text.includes("<Error>")) {
    throw new Error(`Storage could not assemble the upload. ${text.slice(0, 200)}`);
  }
}

/** Give up on a multipart upload, so storage stops holding its parts. */
/**
 * Every multipart upload that has been started and not finished.
 *
 * These are invisible in an ordinary listing: the parts belong to no object yet, so
 * nothing shows them, and storage bills for them until the upload is completed or
 * aborted. That is what makes an abandoned upload expensive rather than merely untidy.
 *
 * Paginated, because a bucket that has been leaking them for a while can hold more
 * than one page, and stopping at the first would leave the rest to accumulate.
 */
export async function listMultipartUploads(): Promise<
  { key: string; uploadId: string; initiated: Date | null }[]
> {
  const { sig, endpoint, bucket } = config();
  const out: { key: string; uploadId: string; initiated: Date | null }[] = [];

  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;

  // A bound rather than `while (true)`: a provider that keeps saying "truncated"
  // without advancing the marker would otherwise loop forever inside a cron run.
  for (let page = 0; page < 20; page += 1) {
    const query: Record<string, string> = { uploads: "" };
    if (keyMarker) query["key-marker"] = keyMarker;
    if (uploadIdMarker) query["upload-id-marker"] = uploadIdMarker;

    const headers = await signRequest(sig, { method: "GET", endpoint, path: `/${bucket}`, query });
    const search = new URLSearchParams(query).toString();
    const res = await fetch(`${originOf(endpoint)}/${bucket}?${search}`, { headers });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Storage refused to list uploads (HTTP ${res.status}). ${body.slice(0, 200)}`);
    }

    // Split on the element rather than matching across the whole document: xmlTag
    // returns the first occurrence, and there is one of each per entry.
    for (const chunk of body.split("<Upload>").slice(1)) {
      const entry = chunk.split("</Upload>")[0] ?? "";
      const key = xmlTag(entry, "Key");
      const uploadId = xmlTag(entry, "UploadId");
      if (!key || !uploadId) continue;
      const started = xmlTag(entry, "Initiated");
      const initiated = started ? new Date(started) : null;
      out.push({
        key,
        uploadId,
        initiated: initiated && !Number.isNaN(initiated.getTime()) ? initiated : null,
      });
    }

    if (xmlTag(body, "IsTruncated") !== "true") break;
    const nextKey = xmlTag(body, "NextKeyMarker");
    const nextUpload = xmlTag(body, "NextUploadIdMarker");
    if (!nextKey || (nextKey === keyMarker && nextUpload === uploadIdMarker)) break;
    keyMarker = nextKey;
    uploadIdMarker = nextUpload ?? undefined;
  }

  return out;
}

export async function abortMultipartUpload(objectKey: string, uploadId: string): Promise<void> {
  try {
    const { sig, endpoint, bucket } = config();
    const path = `/${bucket}/${objectKey}`;
    const query = { uploadId };
    const headers = await signRequest(sig, { method: "DELETE", endpoint, path, query });
    await fetch(`${objectUrl(endpoint, bucket, objectKey)}?uploadId=${encodeURIComponent(uploadId)}`, {
      method: "DELETE",
      headers,
    });
  } catch (e) {
    // Best effort. Unfinished parts are cleaned up by a bucket lifecycle rule; a
    // failure here must not stop the caller reporting the real problem.
    console.error("[b2] abortMultipartUpload failed", objectKey, (e as Error).message);
  }
}
