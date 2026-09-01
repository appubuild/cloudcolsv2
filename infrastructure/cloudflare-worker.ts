/**
 * Cloudflare Worker — signed CDN delivery for B2-backed objects.
 *
 * Why: the brief forbids proxying large files through the app servers. B2
 * "public" domains are public-to-URL (anyone with the link can GET). Signed,
 * time-limited URLs keep objects private while still serving through the CDN.
 *
 * Deploy: `wrangler deploy` from the infrastructure/ folder (see README here).
 * Env secrets (never committed): B2_SIGNING_KEY (a shared HMAC secret), or use
 * the S3-compatible SigV4 presigner approach below.
 *
 * Two modes (pick one via MODE env):
 *  1. "presign"  — the worker uses B2 application keys to generate a signed
 *      URL and proxies the stream to the caller. Fully private, key held in
 *      the worker only.
 *  2. "ticket"   — the Next.js backend issues a short-lived, HMAC-signed ticket
 *      in the query string (objectKey + exp + signature). The worker validates
 *      the ticket and serves the object directly from B2 private bucket.
 *
 * Mode "ticket" keeps the B2 key entirely out of the client: the client only
 * ever holds the signed ticket. This is the recommended mode.
 */

import { presignUrl } from "../lib/services/sigv4";

export interface Env {
  // Mode "presign":
  B2_ENDPOINT: string;
  B2_REGION: string;
  B2_BUCKET: string;
  B2_ACCESS_KEY_ID: string;
  B2_SECRET_ACCESS_KEY: string;
  // Mode "ticket":
  CDN_TICKET_SECRET: string;
}

// Tiny constant-time string compare (no crypto libs needed).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// WebCrypto HMAC-SHA256 (works in Cloudflare Workers runtime).
async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function validateTicket(params: URLSearchParams, env: Env): Promise<{ objectKey: string; expires: number } | null> {
  const objectKey = params.get("key") ?? "";
  const exp = Number(params.get("exp") ?? 0);
  const sig = params.get("sig") ?? "";
  if (!objectKey || !exp || !sig || !env.CDN_TICKET_SECRET) return null;
  if (Date.now() > exp) return null;
  const expected = await hmacHex(env.CDN_TICKET_SECRET, `${objectKey}:${exp}`);
  if (!timingSafeEqual(expected, sig)) return null;
  return { objectKey, expires: exp };
}

function html(title: string, body: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:sans-serif;padding:2rem">${body}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const mode = env.CDN_TICKET_SECRET ? "ticket" : "presign";

    if (url.pathname === "/__health") {
      return new Response(JSON.stringify({ ok: true, mode }), { headers: { "content-type": "application/json" } });
    }

    if (mode === "ticket") {
      const ticket = await validateTicket(url.searchParams, env);
      if (!ticket) return new Response("Invalid or expired signed URL.", { status: 403 });
      const objectKey = ticket.objectKey;
      // Serve from private B2 via the S3 endpoint using SigV4 — here the worker
      // proxies. To avoid proxy load in production you'd instead front with a
      // Cloudflare R2/B2 custom domain + signed cookie. The worker hands the
      // browser a short-lived presigned URL rather than fetching the object
      // itself — see redirectToB2.
      return redirectToB2(objectKey, env);
    }

    // Mode "presign": worker-held app key generates a short-lived URL. Without
    // CDN_TICKET_SECRET configured we expose a friendly health/status page.
    return html("CloudCols CDN", "<p>CloudCols CDN worker is running. Set <b>CDN_TICKET_SECRET</b> to enable signed ticket delivery.</p>");
  },
};

/**
 * Hands the caller a short-lived presigned URL for the object.
 *
 * The obvious implementation — fetch the object here and return the bytes — is
 * wrong twice over. It routes every byte of every download through our compute,
 * which the architecture explicitly forbids, and buffering a whole file in a
 * Worker exceeds its memory limit for anything but small files. Redirecting
 * costs one signature and no bandwidth, and the browser gets range requests and
 * resumable downloads directly from storage, which a proxy would have to
 * reimplement.
 *
 * The redirect target is valid for five minutes: long enough to start a large
 * download, short enough that a leaked URL is not a lasting grant. Access was
 * already decided by the ticket that got us here.
 */
async function redirectToB2(objectKey: string, env: Env): Promise<Response> {
  const url = await presignUrl(
    {
      accessKeyId: env.B2_ACCESS_KEY_ID,
      secretAccessKey: env.B2_SECRET_ACCESS_KEY,
      region: env.B2_REGION || "us-east-005",
    },
    {
      method: "GET",
      endpoint: env.B2_ENDPOINT,
      bucket: env.B2_BUCKET,
      key: objectKey,
      expiresIn: 300,
    },
  );

  return new Response(null, {
    status: 302,
    headers: {
      location: url,
      // The redirect itself is per-ticket and must never be cached; what it
      // points at is immutable and cached by storage and the CDN.
      "cache-control": "private, no-store",
    },
  });
}
