/**
 * CloudCols CDN worker — signed delivery of B2-backed objects.
 *
 * The whole point of this worker is the shape of the path it creates:
 *
 *     browser ──▶ Cloudflare (this worker) ──▶ Backblaze B2
 *
 * Not `browser ──▶ B2`, and not through the application server. That matters twice
 * over. Backblaze and Cloudflare are Bandwidth Alliance partners, so bytes moving from
 * B2 into Cloudflare cost nothing — but only if they actually move through Cloudflare.
 * And once the bytes pass through here, the ones that are safe to keep can be held at
 * the edge, so the second person to view a thumbnail costs B2 no transaction at all.
 *
 * The previous version of this file validated the ticket and then 302'd the browser to
 * a presigned B2 URL. That is why the CDN was deployed-on-paper and doing nothing: a
 * redirect sends the reader straight to Backblaze, so Cloudflare never sees a single
 * byte, nothing is cacheable, and every download is billed egress. The comment
 * defending it argued that proxying "exceeds memory limits" — true of buffering a file,
 * but this streams: `upstream.body` is handed straight to the response and the worker
 * holds no more of a 1 GB file than it does of a 1 KB one.
 *
 * Authorization happened before the ticket was issued. The app checked ownership or a
 * share grant and signed a capability naming one object, one delivery class and one
 * disposition. This worker's job is to verify that signature, not to re-decide access —
 * it has no database and no session.
 *
 * Deploy: `wrangler deploy -c infrastructure/wrangler.jsonc`. See ./README.md.
 */

import { presignUrl } from "../lib/services/sigv4";
import {
  parseTicket,
  signTicket,
  signaturesMatch,
  cacheHeaderFor,
  edgeCacheable,
  type TicketOptions,
} from "../lib/services/cdnTicket";

/**
 * The two Workers-runtime types this file needs.
 *
 * Declared here rather than pulling in `@cloudflare/workers-types`: that package
 * replaces the DOM lib wholesale, and this repo is one TypeScript project shared with
 * a browser app that needs the DOM. Two shapes are cheaper than a second tsconfig and
 * a dependency that would fight the first.
 */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/** `caches.default` is the Workers edge cache; the DOM's CacheStorage has no such key. */
const edgeCache = (caches as unknown as { default: Cache }).default;

export interface Env {
  B2_ENDPOINT: string;
  B2_REGION: string;
  B2_BUCKET: string;
  B2_ACCESS_KEY_ID: string;
  B2_SECRET_ACCESS_KEY: string;
  /** Shared with the app. Whoever holds it can mint a read capability for any object. */
  CDN_TICKET_SECRET: string;
  /** Comma-separated origins allowed to read these URLs from script. Optional. */
  CDN_ALLOWED_ORIGINS?: string;
}

/**
 * Headers worth passing back from B2.
 *
 * An allowlist rather than a copy of everything: B2 returns `x-amz-*` fields naming
 * internal file ids and upload state, and the reader has no use for them.
 */
const PASSTHROUGH = [
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/__health") {
      return json(
        {
          ok: true,
          configured: Boolean(env.CDN_TICKET_SECRET && env.B2_BUCKET && env.B2_ACCESS_KEY_ID),
          bucket: env.B2_BUCKET ? "set" : "missing",
          secret: env.CDN_TICKET_SECRET ? "set" : "missing",
        },
        request,
        env,
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(request, env),
          "access-control-allow-methods": "GET, HEAD, OPTIONS",
          "access-control-allow-headers": "range, if-none-match, if-modified-since",
          "access-control-max-age": "86400",
        },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return text("Method not allowed.", 405, request, env);
    }

    if (url.pathname !== "/v1/object") {
      return text("Not found.", 404, request, env);
    }

    if (!env.CDN_TICKET_SECRET) {
      // Refusing is the only safe answer. Serving without a secret would mean serving
      // any object to anyone who can name its key.
      return text("CDN is not configured.", 503, request, env);
    }

    const parsed = parseTicket(url.searchParams);
    if (!parsed) return text("Malformed link.", 400, request, env);

    const { options: ticket, signature } = parsed;

    // Signature before expiry: checking expiry first would answer "this key existed"
    // for an unsigned guess.
    const expected = await signTicket(env.CDN_TICKET_SECRET, ticket);
    if (!signaturesMatch(expected, signature)) {
      return text("This link is not valid.", 403, request, env);
    }
    if (Date.now() > ticket.expiresAt) {
      return text("This link has expired.", 403, request, env);
    }

    return deliver(request, env, ctx, ticket);
  },
};

/**
 * Fetches the object from B2 and streams it back.
 *
 * Range requests are forwarded untouched and a 206 comes back untouched, which is what
 * lets a video player seek and a download resume. The alternative — fetching the whole
 * object and slicing it here — would make starting a two-hour video download two hours
 * of B2 traffic.
 */
async function deliver(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  ticket: TicketOptions,
): Promise<Response> {
  const range = request.headers.get("range");
  const cache = edgeCache;

  /**
   * Whether this response may be held at the edge.
   *
   * Only thumbnails and share assets qualify. A private original is never cached,
   * whatever its ticket claims — and since the class is signed, a reader cannot
   * promote their own file into the shared cache by editing the URL.
   *
   * A ranged request is excluded too: a 206 is a slice, not the object, and storing
   * one under the object's key would serve that slice to the next reader.
   */
  const cacheable =
    edgeCacheable(ticket.deliveryClass) && !range && request.method === "GET";

  /**
   * Cache key.
   *
   * Built from the object key, which begins with the owner's user id — so an entry is
   * tenant-scoped by construction and no two accounts can collide on one. Deliberately
   * NOT the request URL: that carries a signature and an expiry that change, and a key
   * that changes is a cache that never hits.
   */
  const cacheKey = new Request(
    `https://cdn-cache.internal/${ticket.deliveryClass}/${encodeURI(ticket.objectKey)}`,
    { method: "GET" },
  );

  if (cacheable) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set("cache-control", cacheHeaderFor(ticket.deliveryClass));
      headers.set("x-cdn-cache", "HIT");
      applyCors(headers, request, env);
      return new Response(hit.body, { status: hit.status, headers });
    }
  }

  const signed = await presignUrl(
    {
      accessKeyId: env.B2_ACCESS_KEY_ID,
      secretAccessKey: env.B2_SECRET_ACCESS_KEY,
      region: env.B2_REGION || "us-east-005",
    },
    {
      method: "GET",
      endpoint: env.B2_ENDPOINT,
      bucket: env.B2_BUCKET,
      key: ticket.objectKey,
      // Only as long as this one subrequest needs. The URL never leaves the worker.
      expiresIn: 120,
    },
  );

  // Conditional and ranged headers are forwarded so the browser's own cache keeps
  // working: a 304 costs no bytes anywhere.
  const forward = new Headers();
  if (range) forward.set("range", range);
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch) forward.set("if-none-match", ifNoneMatch);
  const ifModifiedSince = request.headers.get("if-modified-since");
  if (ifModifiedSince) forward.set("if-modified-since", ifModifiedSince);

  const upstream = await fetch(signed, { method: request.method, headers: forward });

  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
    // B2's XML error body names the bucket and key. Nothing there is the reader's to
    // read, and 404-vs-403 from storage is not a distinction worth leaking either.
    const status = upstream.status === 404 ? 404 : 502;
    return text(
      status === 404 ? "File not found." : "Storage is unavailable.",
      status,
      request,
      env,
    );
  }

  const headers = new Headers();
  for (const name of PASSTHROUGH) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  // The type and filename come from the ticket, not from B2. B2 stores whatever was
  // sent at upload; the app knows what it recorded, and it signed that in — so the two
  // cannot drift, and a renamed file downloads under its current name.
  headers.set(
    "content-type",
    ticket.contentType || upstream.headers.get("content-type") || "application/octet-stream",
  );
  headers.set("content-disposition", contentDisposition(ticket));
  headers.set("cache-control", cacheHeaderFor(ticket.deliveryClass));

  // Says the object supports ranges even on a plain 200, so a video player knows it
  // may seek instead of downloading to the end.
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");

  // A stored file is not this origin's content: it must never be sniffed into
  // something executable.
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-cdn-cache", cacheable ? "MISS" : "BYPASS");
  applyCors(headers, request, env);

  if (request.method === "HEAD" || upstream.status === 304 || !upstream.body) {
    return new Response(null, { status: upstream.status, headers });
  }

  if (!cacheable) {
    // Streamed, not buffered: the worker holds a chunk at a time, so object size is
    // not bounded by worker memory.
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  // Cacheable: one copy to the reader, one to the edge, neither waiting on the other.
  const [toReader, toCache] = upstream.body.tee();
  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(toCache, { status: 200, headers: cacheEntryHeaders(headers, ticket) }),
    ),
  );
  return new Response(toReader, { status: upstream.status, headers });
}

/**
 * Headers stored on the cache entry.
 *
 * `cache-control` on the stored copy governs how long the *edge* keeps it, which is a
 * different question from how long a browser may. The reader's copy keeps `private`;
 * this one has to say `public` or the Cache API declines to store it at all — and it
 * is safe here precisely because the key is tenant-scoped and only ever holds
 * thumbnails and share assets.
 *
 * CORS is stripped: the stored copy is shared across readers from different origins,
 * and freezing one origin's header into it would break the others.
 */
function cacheEntryHeaders(headers: Headers, ticket: TicketOptions): Headers {
  const stored = new Headers(headers);
  stored.delete("access-control-allow-origin");
  stored.delete("vary");
  stored.delete("x-cdn-cache");
  stored.set(
    "cache-control",
    ticket.deliveryClass === "t" ? "public, max-age=86400" : "public, max-age=300",
  );
  return stored;
}

/** RFC 5987 disposition, so non-ASCII filenames survive the trip. */
function contentDisposition(ticket: TicketOptions): string {
  if (ticket.disposition !== "a") return "inline";
  const name = ticket.filename;
  if (!name) return "attachment";
  // Quotes and control characters would end the header value early; the encoded form
  // carries the real name for every browser that matters.
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Cross-origin access.
 *
 * These URLs carry their own authorization and are never accompanied by a cookie, so a
 * permissive default leaks nothing: a caller who can read one already holds a signed
 * capability for it. `CDN_ALLOWED_ORIGINS` narrows it anyway where the deployment knows
 * its own front end.
 */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowed = (env.CDN_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowed.length === 0) {
    return {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": PASSTHROUGH.join(", "),
    };
  }
  if (origin && allowed.includes(origin)) {
    return {
      "access-control-allow-origin": origin,
      // Without this a shared cache could hand one origin's response to another.
      vary: "Origin",
      "access-control-expose-headers": PASSTHROUGH.join(", "),
    };
  }
  return {};
}

function applyCors(headers: Headers, request: Request, env: Env): void {
  for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v);
}

function text(body: string, status: number, request: Request, env: Env): Response {
  const headers = new Headers({
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "private, no-store",
  });
  applyCors(headers, request, env);
  return new Response(body, { status, headers });
}

function json(body: unknown, request: Request, env: Env): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "private, no-store",
  });
  applyCors(headers, request, env);
  return new Response(JSON.stringify(body), { headers });
}
