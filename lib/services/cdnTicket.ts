/**
 * Signed tickets for the CDN worker.
 *
 * Pure functions with no server-only guard so the worker in infrastructure/ can
 * import the same code that mints them. One implementation of the canonical string
 * is the whole point: a signer and a verifier that drift produce either a security
 * hole or an outage, and nothing in between.
 *
 * A ticket is a capability. It names one object, one delivery class, one disposition
 * and an expiry, and it is signed over all of them — so a holder cannot rewrite any
 * field, least of all the class that decides whether a response may be cached.
 */

/**
 * How a response may be cached.
 *
 * Part of the signed ticket rather than a query flag, because it is a security
 * decision: a client that could set this itself could ask for its private original
 * to be cached at the edge.
 *
 *   t  thumbnail — small, immutable derivative. Edge-cacheable.
 *   s  public share asset. Edge-cacheable.
 *   p  private original. Never edge-cached.
 *
 * `security-engineer` §6 allows exactly the first two. Cache keys are the object key,
 * which begins with the owner's id — so an entry is tenant-scoped by construction and
 * two accounts cannot collide.
 */
export type DeliveryClass = "t" | "s" | "p";

export interface TicketOptions {
  objectKey: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  deliveryClass: DeliveryClass;
  /** "a" makes the browser save the file; "i" lets it render in place. */
  disposition: "i" | "a";
  /** Sent as the filename when the disposition is attachment. */
  filename?: string;
  contentType?: string;
}

/**
 * The exact bytes that get signed.
 *
 * Field order and separator are fixed, and every field that changes the response is
 * included. Leaving one out — the disposition, say — would let a holder flip a
 * view-only link into a download by editing the query string.
 */
export function canonicalTicket(o: TicketOptions): string {
  return [
    o.objectKey,
    String(o.expiresAt),
    o.deliveryClass,
    o.disposition,
    o.filename ?? "",
    o.contentType ?? "",
  ].join("\n");
}

/** HMAC-SHA256 over the canonical string, hex. Web Crypto, so it runs in a Worker. */
export async function signTicket(secret: string, o: TicketOptions): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalTicket(o)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two hex signatures. */
export function signaturesMatch(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Query string for a ticket, without the leading "?". */
export function ticketQuery(o: TicketOptions, signature: string): string {
  const p = new URLSearchParams({
    key: o.objectKey,
    exp: String(o.expiresAt),
    c: o.deliveryClass,
    d: o.disposition,
    sig: signature,
  });
  if (o.filename) p.set("n", o.filename);
  if (o.contentType) p.set("ct", o.contentType);
  return p.toString();
}

/** Reads a ticket back out of a query string. Returns null if a required field is absent. */
export function parseTicket(params: URLSearchParams): { options: TicketOptions; signature: string } | null {
  const objectKey = params.get("key");
  const exp = Number(params.get("exp"));
  const deliveryClass = params.get("c");
  const disposition = params.get("d");
  const signature = params.get("sig");

  if (!objectKey || !Number.isFinite(exp) || !signature) return null;
  if (deliveryClass !== "t" && deliveryClass !== "s" && deliveryClass !== "p") return null;
  if (disposition !== "i" && disposition !== "a") return null;

  return {
    options: {
      objectKey,
      expiresAt: exp,
      deliveryClass,
      disposition,
      filename: params.get("n") ?? undefined,
      contentType: params.get("ct") ?? undefined,
    },
    signature,
  };
}

/**
 * How long a browser may keep a response, and whether the edge may keep it at all.
 *
 * `private` throughout: these are one account's files, and no shared proxy between
 * Cloudflare and the reader should hold them. The edge cache is separate — the worker
 * decides that itself, and only for the two classes that are allowed it.
 */
export function cacheHeaderFor(deliveryClass: DeliveryClass): string {
  switch (deliveryClass) {
    case "t":
      // Derivatives are immutable: a new thumbnail is a new object key.
      return "private, max-age=86400, immutable";
    case "s":
      // Short, so revoking a share stops working within minutes rather than whenever
      // a browser next decides to revalidate.
      //
      // Revocation is bounded, not immediate: a ticket already in someone's hands
      // stays valid until it expires, and an edge entry lives out its TTL. Both are
      // capped at five minutes, which is exactly what the presigned storage URLs this
      // replaced allowed. Making it immediate needs a cache purge on revoke, which
      // needs a Cloudflare API token the app does not hold today.
      return "private, max-age=300";
    case "p":
    default:
      // A private original. No shared cache may keep it at all — but the browser that
      // was authorised to fetch it may reuse what it already has for as long as the
      // ticket it used is valid.
      //
      // That upper bound is the whole argument: anyone holding this URL can refetch
      // the bytes until it expires, so letting them reuse bytes already on their own
      // disk grants nothing new. It is what makes replaying a video instant instead
      // of another round trip to storage.
      return "private, max-age=3000, no-transform";
  }
}

/** Whether the Cloudflare edge may hold this class. */
export function edgeCacheable(deliveryClass: DeliveryClass): boolean {
  return deliveryClass === "t" || deliveryClass === "s";
}
