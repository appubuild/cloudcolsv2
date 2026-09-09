// Proving, at the CDN, that the caller is the person the link was issued to.
//
// The link itself cannot do that. A signed URL is a bearer capability: copy the string
// out of the network tab, send it to anyone, and it works until it expires. That is
// acceptable for a share link and wrong for somebody's private video.
//
// So alongside the link the app sets a cookie, scoped to the domain both it and the
// CDN sit under, carrying a signed claim about who is signed in. The ticket names the
// same person. The worker honours the ticket only when the two agree — which a copied
// URL, arriving from a browser that never had the cookie, cannot manage.
//
// The cookie is httpOnly, so script on the page cannot read it either.

import "server-only";
import { serverEnv } from "@/lib/config/server-env";
import { setResponseHeader } from "@/lib/api/auth";
import {
  DELIVERY_COOKIE,
  DELIVERY_COOKIE_TTL_MS,
  cookieDomainFor,
  mintDeliveryCookie,
} from "@/lib/services/deliveryCookie";

/**
 * Issues the delivery cookie on this response and reports whether links may be bound.
 *
 * Returns the user id when binding is possible, and undefined when it is not — no CDN,
 * no shared parent domain between the app and the CDN, no secret. Undefined means the
 * caller should issue an unbound link: the same capability URL the product has always
 * used, rather than one nothing can satisfy.
 */
export async function establishDeliverySession(
  req: Request,
  userId: string,
): Promise<string | undefined> {
  const secret = serverEnv.cdn.ticketSecret;
  const cdnDomain = serverEnv.cdn.domain;
  if (!secret || !cdnDomain) return undefined;

  const appHost = new URL(req.url).hostname;
  const domain = cookieDomainFor(appHost, cdnDomain);
  // Nothing sensible to scope a cookie to — the two hosts share no registrable
  // domain, so the browser would never send it to the CDN.
  if (!domain) return undefined;

  const expiresAt = Date.now() + DELIVERY_COOKIE_TTL_MS;
  const value = await mintDeliveryCookie(secret, userId, expiresAt);

  // Lax rather than Strict: the CDN is a different host, and although it is the same
  // site — so the cookie travels regardless — Strict would also drop it when someone
  // arrives from an external link, which is exactly when a preview needs to work.
  setResponseHeader(
    req,
    "set-cookie",
    [
      `${DELIVERY_COOKIE}=${value}`,
      `Domain=${domain}`,
      "Path=/",
      `Max-Age=${Math.floor(DELIVERY_COOKIE_TTL_MS / 1000)}`,
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
    ].join("; "),
  );

  return userId;
}
