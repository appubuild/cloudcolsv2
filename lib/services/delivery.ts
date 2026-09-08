// One answer to "what URL should the browser fetch for this object?".
//
// Every delivery path — download, preview, thumbnail, share — goes through here, so
// there is a single place that decides between the CDN and storage. The alternative
// is what this codebase had: each route presigning B2 for itself, a CDN module with
// no callers, and no way to tell from the outside which path a byte actually took.
//
// Authorization is NOT decided here. The caller has already established that this
// user may read this object; this only chooses a transport.

import "server-only";
import { cdnUrl, cdnConfigured, type DeliveryClass } from "./cdn";
import { getPresignedDownloadUrl } from "./b2";

export interface DeliveryRequest {
  objectKey: string;
  deliveryClass: DeliveryClass;
  disposition?: "inline" | "attachment";
  /** Name the browser should save under. Only used with an attachment disposition. */
  filename?: string;
  contentType?: string;
  /** Lifetime of the presigned fallback. The CDN ticket has its own, longer, TTL. */
  fallbackTtlSeconds?: number;
}

export interface Delivery {
  url: string;
  expiresIn: number;
  /**
   * Which path the bytes will take.
   *
   * Reported so tests and /api/health can assert it rather than infer it. "b2" means
   * the reader talks to Backblaze directly: it works, but nothing is cached and every
   * byte is billed egress — the condition this whole layer exists to end.
   */
  via: "cdn" | "b2";
}

/** Rough remaining life of a CDN ticket. Its real expiry is quantised; see ./cdn.ts. */
const CDN_TICKET_MIN_LIFETIME: Record<DeliveryClass, number> = {
  t: 23 * 60 * 60,
  s: 4 * 60,
  p: 50 * 60,
};

export async function resolveDelivery(req: DeliveryRequest): Promise<Delivery> {
  const viaCdn = await cdnUrl(req.objectKey, {
    deliveryClass: req.deliveryClass,
    disposition: req.disposition,
    filename: req.filename,
    contentType: req.contentType,
  });

  if (viaCdn) {
    return { url: viaCdn, expiresIn: CDN_TICKET_MIN_LIFETIME[req.deliveryClass], via: "cdn" };
  }

  // No CDN configured. A presigned B2 URL still serves the file correctly, and it
  // still supports ranges, so video and resume keep working — it just costs money
  // and caches nothing.
  const ttl = req.fallbackTtlSeconds ?? 600;
  const { presignedUrl, expiresIn } = await getPresignedDownloadUrl(req.objectKey, ttl, {
    ...(req.disposition === "attachment" && req.filename ? { downloadFilename: req.filename } : {}),
    ...(req.contentType ? { contentType: req.contentType } : {}),
  });
  return { url: presignedUrl, expiresIn, via: "b2" };
}

export { cdnConfigured };
