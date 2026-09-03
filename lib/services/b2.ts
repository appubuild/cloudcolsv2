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
