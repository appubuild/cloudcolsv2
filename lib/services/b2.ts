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

/** A CDN/convenience public URL for a key (used only for public share content). */
export function publicUrl(objectKey: string): string {
  if (serverEnv.b2.publicDomain) {
    return `https://${serverEnv.b2.publicDomain}/${objectKey}`;
  }
  return `${originOf(serverEnv.b2.endpoint)}/${serverEnv.b2.bucket}/${objectKey}`;
}

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

/**
 * How big each part is.
 *
 * 8 MB rather than 16. Parts are uploaded several at a time, so the size that
 * matters is not throughput per part but how much is lost when one fails and how
 * often progress moves. Smaller parts retry cheaper and make the bar honest.
 *
 * At this size a 3 GB file is 384 parts, comfortably under the 10,000 limit.
 */
export const MULTIPART_PART_SIZE = 8 * 1024 * 1024;

/**
 * Above this, an upload is split.
 *
 * Below it the overhead is not worth it: a single PUT is one round trip, and
 * multipart adds a create, a complete, and a presign per part.
 */
export const MULTIPART_THRESHOLD = 32 * 1024 * 1024;

/** S3 allows at most this many parts per object. */
export const MULTIPART_MAX_PARTS = 10_000;

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
