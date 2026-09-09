// CDN delivery (server-only).
//
// Turns an object key into the URL a browser should actually fetch. That URL points
// at the Cloudflare worker, which authenticates to B2 and streams the bytes back —
// so the path is  user → Cloudflare → B2,  never  user → B2  and never through this
// app's compute. Two things follow from that shape: egress from B2 to Cloudflare is
// free under the Bandwidth Alliance, and thumbnails can be held at the edge so the
// second viewer costs B2 nothing at all.
//
// When the CDN is not configured the caller falls back to a presigned B2 URL. That
// still works, and it is what the product ran on until now, but it bills every byte
// and caches nothing — so `cdnConfigured()` is reported by /api/health rather than
// being left to guess at.

import "server-only";
import { serverEnv } from "@/lib/config/server-env";
import {
  signTicket,
  ticketQuery,
  type DeliveryClass,
  type TicketOptions,
} from "./cdnTicket";

export type { DeliveryClass } from "./cdnTicket";

/**
 * Ticket lifetime, and the grid it is rounded up to.
 *
 * The rounding is what makes caching work at all. `exp = now + ttl` produces a
 * different URL on every single request, so the browser cache, the edge cache and
 * any conditional request all miss every time — the CDN would be deployed and still
 * fetch from B2 for each thumbnail tile. Rounding the expiry up to a fixed boundary
 * makes every request inside that window produce byte-identical URLs, which is what
 * a cache key needs.
 *
 * The cost is that the real lifetime varies between `ttl - window` and `ttl`.
 */
const LIFETIME: Record<DeliveryClass, { ttlMs: number; windowMs: number }> = {
  // Thumbnails are immutable and tiny. A long window keeps a scrolled grid on
  // browser cache for the whole session.
  t: { ttlMs: 24 * 60 * 60 * 1000, windowMs: 60 * 60 * 1000 },
  // Share assets. Deliberately the same five minutes the presigned B2 URL used to
  // last, because a ticket stays valid until it expires even after the share row is
  // revoked — so lengthening it would widen the revocation gap. See the note on
  // revocation in ./cdnTicket.ts.
  s: { ttlMs: 5 * 60 * 1000, windowMs: 60 * 1000 },
  // Private originals. Long enough to start and resume a large download.
  p: { ttlMs: 60 * 60 * 1000, windowMs: 10 * 60 * 1000 },
};

function expiryFor(deliveryClass: DeliveryClass, now: number): number {
  const { ttlMs, windowMs } = LIFETIME[deliveryClass];
  return Math.ceil((now + ttlMs) / windowMs) * windowMs;
}

/** Base URL of the CDN worker, without a trailing slash. Empty when unconfigured. */
function cdnOrigin(): string {
  const domain = serverEnv.cdn.domain;
  if (!domain) return "";
  const withScheme = domain.startsWith("http") ? domain : `https://${domain}`;
  return withScheme.endsWith("/") ? withScheme.slice(0, -1) : withScheme;
}

/**
 * Whether delivery can go through Cloudflare.
 *
 * Both halves are needed: a domain with no secret would mint unsigned URLs, and a
 * secret with no domain has nowhere to send them.
 */
export function cdnConfigured(): boolean {
  return Boolean(cdnOrigin() && serverEnv.cdn.ticketSecret);
}

export interface DeliveryOptions {
  deliveryClass: DeliveryClass;
  /** "attachment" makes the browser save the file, "inline" lets it render. */
  disposition?: "inline" | "attachment";
  /** Filename offered on save. Only meaningful with an attachment disposition. */
  filename?: string;
  contentType?: string;
  /**
   * Bind the link to this account.
   *
   * The worker then also requires a signed cookie naming the same person, so the URL
   * on its own is useless to anyone else. Set for a person's own files; left unset for
   * share assets, where passing the link around is the point.
   */
  userId?: string;
}

/**
 * A signed CDN URL for one object, or null when the CDN is not configured.
 *
 * Null is a routine answer, not an error: callers fall back to a presigned B2 URL so
 * the product keeps working before the worker is deployed.
 */
export async function cdnUrl(objectKey: string, opts: DeliveryOptions): Promise<string | null> {
  const origin = cdnOrigin();
  const secret = serverEnv.cdn.ticketSecret;
  if (!origin || !secret) return null;

  const ticket: TicketOptions = {
    objectKey,
    expiresAt: expiryFor(opts.deliveryClass, Date.now()),
    deliveryClass: opts.deliveryClass,
    disposition: opts.disposition === "attachment" ? "a" : "i",
    // Sent only when it changes the response, so an inline URL and its attachment
    // twin do not differ by a field neither of them uses.
    ...(opts.disposition === "attachment" && opts.filename ? { filename: opts.filename } : {}),
    ...(opts.contentType ? { contentType: opts.contentType } : {}),
    ...(opts.userId ? { userId: opts.userId } : {}),
  };

  const signature = await signTicket(secret, ticket);
  return `${origin}/v1/object?${ticketQuery(ticket, signature)}`;
}

/**
 * Best-effort readable URL for an object, CDN first.
 *
 * Kept for callers that only need "a URL that reads this key" and have no presigned
 * fallback of their own. Unlike the previous version this never falls back to a raw
 * B2 endpoint URL: that URL is unauthenticated against a private bucket, so it was
 * always going to 403, and returning it made an unconfigured CDN look configured.
 */
export async function readableUrl(
  objectKey: string,
  deliveryClass: DeliveryClass = "p",
): Promise<string | null> {
  return cdnUrl(objectKey, { deliveryClass });
}
