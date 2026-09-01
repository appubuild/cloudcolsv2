/**
 * AWS Signature Version 4 — implemented with Web Crypto so it runs in Workers.
 *
 * Used to presign S3-compatible requests against Backblaze B2. Presigning is pure
 * local computation: no network call, no round trip to the storage provider. That is
 * what makes issuing an upload or download URL cheap enough to do on every request.
 *
 * Deliberately provider-neutral — the same code signs for B2, R2, S3, Wasabi or MinIO
 * (product-planner invariant 7).
 */

const enc = new TextEncoder();

async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === 'string' ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
}

/**
 * RFC 3986 encoding. `encodeURIComponent` leaves !'()* unescaped, which produces a
 * signature mismatch on object keys containing those characters.
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = '';
  for (const ch of value) {
    const isUnreserved =
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '-' ||
      ch === '_' ||
      ch === '.' ||
      ch === '~';
    if (isUnreserved) {
      out += ch;
    } else if (ch === '/') {
      out += encodeSlash ? '%2F' : '/';
    } else {
      for (const byte of enc.encode(ch)) {
        out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return out;
}

function amzDate(d: Date): { full: string; short: string } {
  const full = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { full, short: full.slice(0, 8) };
}

export interface SigV4Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

async function signingKey(cfg: SigV4Config, shortDate: string): Promise<ArrayBuffer> {
  const kDate = await hmac(enc.encode(`AWS4${cfg.secretAccessKey}`), shortDate);
  const kRegion = await hmac(kDate, cfg.region);
  const kService = await hmac(kRegion, cfg.service ?? 's3');
  return hmac(kService, 'aws4_request');
}

export interface PresignOptions {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE' | 'HEAD';
  /** Full origin, e.g. https://s3.us-east-005.backblazeb2.com */
  endpoint: string;
  bucket: string;
  /** Object key, unencoded. */
  key: string;
  expiresIn: number;
  /** Extra query parameters, e.g. uploadId and partNumber for multipart. */
  query?: Record<string, string>;
  /** Headers to bind into the signature. Host is always included. */
  signedHeaders?: Record<string, string>;
  now?: Date;
}

/**
 * Produces a presigned URL. The client uses it directly against storage — our compute
 * never sees the bytes (invariant 1).
 */
export async function presignUrl(cfg: SigV4Config, opts: PresignOptions): Promise<string> {
  const service = cfg.service ?? 's3';
  const now = opts.now ?? new Date();
  const { full, short } = amzDate(now);

  const origin = opts.endpoint.startsWith('http') ? opts.endpoint : `https://${opts.endpoint}`;
  const host = new URL(origin).host;

  // Path-style addressing: /{bucket}/{key}. Works across every S3-compatible provider,
  // including ones whose virtual-host style needs DNS we do not control.
  const canonicalUri = `/${uriEncode(opts.bucket, false)}/${uriEncode(opts.key, false)}`;

  const headers: Record<string, string> = { host, ...(opts.signedHeaders ?? {}) };
  const sortedHeaderKeys = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders =
    sortedHeaderKeys
      .map((h) => {
        const value = headers[Object.keys(headers).find((k) => k.toLowerCase() === h) as string];
        return `${h}:${String(value).trim().replace(/\s+/g, ' ')}`;
      })
      .join('\n') + '\n';
  const signedHeaderList = sortedHeaderKeys.join(';');

  const credential = `${cfg.accessKeyId}/${short}/${cfg.region}/${service}/aws4_request`;

  const queryParams: Record<string, string> = {
    ...(opts.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': full,
    'X-Amz-Expires': String(opts.expiresIn),
    'X-Amz-SignedHeaders': signedHeaderList,
  };

  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(queryParams[k] as string)}`)
    .join('&');

  const canonicalRequest = [
    opts.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderList,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    full,
    `${short}/${cfg.region}/${service}/aws4_request`,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const key = await signingKey(cfg, short);
  const signature = toHex(new Uint8Array(await hmac(key, stringToSign)));

  return `${origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Signs a request the API itself makes (bucket listing, HEAD for upload verification,
 * multipart create/complete). Returns headers to attach to fetch.
 */
export async function signRequest(
  cfg: SigV4Config,
  opts: {
    method: string;
    endpoint: string;
    path: string;
    query?: Record<string, string>;
    body?: string;
    now?: Date;
  },
): Promise<Record<string, string>> {
  const service = cfg.service ?? 's3';
  const now = opts.now ?? new Date();
  const { full, short } = amzDate(now);

  const origin = opts.endpoint.startsWith('http') ? opts.endpoint : `https://${opts.endpoint}`;
  const host = new URL(origin).host;
  const payloadHash = await sha256Hex(opts.body ?? '');

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': full,
  };

  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((h) => `${h}:${headers[h]}`).join('\n') + '\n';
  const signedHeaderList = sortedKeys.join(';');

  const canonicalQuery = Object.keys(opts.query ?? {})
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode((opts.query as Record<string, string>)[k] as string)}`)
    .join('&');

  const canonicalRequest = [
    opts.method,
    opts.path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderList,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    full,
    `${short}/${cfg.region}/${service}/aws4_request`,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const key = await signingKey(cfg, short);
  const signature = toHex(new Uint8Array(await hmac(key, stringToSign)));

  return {
    ...headers,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${short}/${cfg.region}/${service}/aws4_request, ` +
      `SignedHeaders=${signedHeaderList}, Signature=${signature}`,
  };
}
