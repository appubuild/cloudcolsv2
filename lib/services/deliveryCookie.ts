// Tying a delivery link to the browser that was given it.
//
// A signed URL is a capability: whoever holds the string can read the object until it
// expires. That is how presigned storage URLs have always worked here, and it is fine
// for a share link — a share is meant to be passed around. It is not fine for someone's
// private video, where copying the address out of the network tab hands it to anybody.
//
// So a private ticket now names its owner, and the worker will only honour it when the
// request also carries a cookie proving the caller is that owner. The URL alone stops
// being enough. Both halves are signed with the same secret, and neither can be minted
// without it.
//
// Pure, and shared with the worker: one implementation of the format, because a signer
// and a verifier that drift produce either a hole or an outage.

/** Name of the cookie. Short and unremarkable; it carries no meaning on its own. */
export const DELIVERY_COOKIE = "cc_dk";

/**
 * How long the cookie is good for.
 *
 * Longer than any ticket, so a link never outlives the proof needed to use it. It is
 * reissued on every delivery request, so an active session never runs out.
 */
export const DELIVERY_COOKIE_TTL_MS = 12 * 60 * 60 * 1000;

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `v1.<userId>.<expiry>.<signature>` — no secrets inside, only a signed claim. */
export async function mintDeliveryCookie(
  secret: string,
  userId: string,
  expiresAt: number,
): Promise<string> {
  const body = `v1.${userId}.${expiresAt}`;
  return `${body}.${await hmacHex(secret, body)}`;
}

export async function verifyDeliveryCookie(
  secret: string,
  value: string | null | undefined,
): Promise<{ userId: string; expiresAt: number } | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;

  const [, userId, expRaw, signature] = parts as [string, string, string, string];
  const expiresAt = Number(expRaw);
  if (!userId || !Number.isFinite(expiresAt)) return null;

  const expected = await hmacHex(secret, `v1.${userId}.${expRaw}`);
  if (!constantTimeEqual(expected, signature)) return null;
  if (Date.now() > expiresAt) return null;

  return { userId, expiresAt };
}

/** Pulls one cookie out of a raw Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * The domain a cookie must carry to reach both the app and the CDN.
 *
 * They are different hosts — cloudcols.com and cdn.cloudcols.com — so the cookie has
 * to be scoped to the part they share. Returns null when they share nothing usable,
 * in which case there is no point issuing one and tickets are left unbound rather than
 * silently unusable.
 */
export function cookieDomainFor(appHost: string, cdnHost: string): string | null {
  if (!appHost || !cdnHost) return null;
  const strip = (h: string) => h.replace(/^https?:\/\//, "").split("/")[0]!.split(":")[0]!.toLowerCase();
  const a = strip(appHost).split(".");
  const c = strip(cdnHost).split(".");

  const shared: string[] = [];
  for (let i = 1; i <= Math.min(a.length, c.length); i += 1) {
    const labelA = a[a.length - i];
    const labelC = c[c.length - i];
    if (labelA !== labelC) break;
    shared.unshift(labelA!);
  }

  // Two labels is the shortest thing that can be a real registrable domain. One would
  // be a public suffix like "com", which no browser accepts.
  if (shared.length < 2) return null;
  return shared.join(".");
}
