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
  canonicalTicketLegacy,
  edgeCacheable,
  type TicketOptions,
} from "../lib/services/cdnTicket";
import {
  DELIVERY_COOKIE,
  readCookie,
  verifyDeliveryCookie,
} from "../lib/services/deliveryCookie";

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
  /**
   * A second secret, accepted alongside the first.
   *
   * Rotating one shared secret across two Workers is otherwise an outage: whichever is
   * updated first disagrees with the other until the second catches up, and every link
   * in between fails. With this, the new secret is added here, the app is moved to it,
   * and only then is this one folded into CDN_TICKET_SECRET and removed — no moment at
   * which a valid link is refused.
   *
   * Unset in normal operation.
   */
  CDN_TICKET_SECRET_NEXT?: string;
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

    // Every secret currently in service. One in normal operation; two while one is
    // being rotated.
    const secrets = [env.CDN_TICKET_SECRET, env.CDN_TICKET_SECRET_NEXT].filter(
      (s): s is string => Boolean(s),
    );

    // Signature before expiry: checking expiry first would answer "this key existed"
    // for an unsigned guess.
    let valid = false;
    for (const secret of secrets) {
      if (signaturesMatch(await signTicket(secret, ticket), signature)) {
        valid = true;
        break;
      }
    }

    if (!valid && !ticket.userId) {
      // A link handed out by the version of the app that signed without an owner
      // field. Those stay valid for up to an hour after a deploy, and refusing them
      // would break every download already open in somebody's browser. An old-format
      // ticket can no more be forged than a new one — it is the same secret — it just
      // carries no owner, so nothing is bound to check it against.
      for (const secret of secrets) {
        if (signaturesMatch(await signTicket(secret, ticket, canonicalTicketLegacy), signature)) {
          valid = true;
          break;
        }
      }
    }

    if (!valid) return text("This link is not valid.", 403, request, env);
    if (Date.now() > ticket.expiresAt) {
      return text("This link has expired.", 403, request, env);
    }

    /**
     * A ticket that names an owner is not a bearer token.
     *
     * The URL alone used to be enough: copied out of the network tab and sent on, it
     * played for whoever received it until it expired. Now the app also sets a signed,
     * httpOnly cookie on the domain both it and this worker sit under, and a bound
     * link is only honoured from a browser that has it.
     *
     * Share links carry no owner and are deliberately left as they were — passing them
     * around is what they are for.
     */
    if (ticket.userId) {
      const presented = readCookie(request.headers.get("cookie"), DELIVERY_COOKIE);
      let cookie = null;
      for (const secret of secrets) {
        cookie = await verifyDeliveryCookie(secret, presented);
        if (cookie) break;
      }
      if (!cookie || cookie.userId !== ticket.userId) {
        return text("This link only works for the account it was issued to.", 403, request, env);
      }
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
   *
   * The disposition is in the key because it is in the stored response. Two share
   * links can point at one file with different permissions — one to view, one to
   * download — and without this the first to be fetched would decide what the other
   * one did, serving a view link's headers to someone who was given a download link.
   */
  const cacheKey = new Request(
    `https://cdn-cache.internal/${ticket.deliveryClass}${ticket.disposition}/${encodeURI(ticket.objectKey)}`,
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
      // Signed for the method actually being sent. A GET-signed URL used for HEAD is a
      // 403 from storage. That was invisible while Cloudflare's cache layer sat in front
      // of this subrequest, because it quietly turned every HEAD into a GET; with that
      // layer bypassed, HEAD reaches B2 as HEAD and the signature has to say so.
      method: request.method === "HEAD" ? "HEAD" : "GET",
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

  /**
   * Cloudflare must not put its own cache between this worker and B2.
   *
   * Measured against the live bucket, reading 256 KB out of a 338 MB object:
   *
   *     offset   via this worker   straight from B2
   *        0%            1 388 ms            1 005 ms
   *       25%           10 160 ms            1 028 ms
   *       50%           18 937 ms              926 ms
   *       90%           32 902 ms              939 ms
   *
   * B2 is flat at any offset; the worker grew linearly with it. That shape is the
   * signature of something reading from the start of the object and discarding bytes
   * until it reaches the range — which is what the edge cache does when it decides to
   * fill itself from a ranged subrequest. Seeking to the middle of a long video cost
   * nineteen seconds because of it.
   *
   * Nothing is lost by switching it off. Private originals are never cached anyway,
   * and the classes that are use the Cache API explicitly, further down, with a key
   * this worker controls — the presigned URL here carries a fresh signature every
   * time, so it could never have been a cache hit regardless.
   */
  const upstreamStarted = Date.now();
  const upstream = await fetch(signed, {
    method: request.method,
    headers: forward,
    // Bypass Cloudflare's own cache layer for this subrequest entirely. Without it the
    // Range header never reaches B2: Cloudflare fetches the object from byte zero,
    // hands back synthesised 206 headers at once, and then reads and discards
    // everything before the requested offset — ten seconds per 100 MB of seek.
    cache: "no-store",
  });

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
  /**
   * How long storage took to answer, and what it answered with.
   *
   * Here because a ranged read was measured at 19 seconds through this worker and
   * 1 second straight from the bucket, and no amount of reading the code settled
   * where the difference lived. A number the worker reports itself is the only thing
   * that can.
   */
  headers.set("x-upstream-ms", String(Date.now() - upstreamStarted));
  headers.set("x-upstream-status", String(upstream.status));
  headers.set("x-upstream-length", upstream.headers.get("content-length") ?? "-");
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
      // The delivery cookie has to ride along on script-initiated reads — the text
      // editor, the thumbnail backfill, pdf.js — and a credentialed response may not
      // answer with a wildcard origin, which is the other reason the allowlist exists.
      "access-control-allow-credentials": "true",
      // Without this a shared cache could hand one origin's response to another.
      vary: "Origin, Cookie",
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
