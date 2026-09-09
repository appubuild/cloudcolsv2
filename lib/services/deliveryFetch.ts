"use client";

// Whether a read of a delivery URL should carry the delivery cookie.
//
// Private links are bound to the account now, and the proof is an httpOnly cookie on
// the domain the app and the CDN share. A browser sends it on its own for an <img> or
// a <video src>, but `fetch` to another subdomain defaults to sending nothing, and a
// media element with `crossOrigin="anonymous"` explicitly refuses to.
//
// It cannot simply be switched on everywhere. When the CDN is not configured these
// same URLs point straight at Backblaze, which is a different site and answers no
// credentialed request — asking for credentials there fails the fetch outright. So the
// decision is made from the URL: same site, send the cookie; anywhere else, do not.

/** The registrable-ish domain: the last two labels, which is what a cookie is scoped to. */
function registrable(hostname: string): string {
  const labels = hostname.toLowerCase().split(".");
  return labels.length <= 2 ? labels.join(".") : labels.slice(-2).join(".");
}

function sameSite(url: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const target = new URL(url, window.location.href);
    if (target.origin === window.location.origin) return true;
    // A cookie set for cloudcols.com reaches cdn.cloudcols.com; it reaches nothing on
    // another registrable domain, so there is no point asking for one.
    return registrable(target.hostname) === registrable(window.location.hostname);
  } catch {
    return false;
  }
}

/** What to pass as `credentials` when reading this URL with fetch. */
export function deliveryCredentials(url: string): RequestCredentials {
  return sameSite(url) ? "include" : "omit";
}

/**
 * What to put in a media element's `crossOrigin` when the pixels will be read back.
 *
 * The attribute is required either way — without it the canvas is tainted and encoding
 * the frame throws — but "anonymous" sends no cookie, which a bound link rejects.
 */
export function deliveryCrossOrigin(url: string): "anonymous" | "use-credentials" {
  return sameSite(url) ? "use-credentials" : "anonymous";
}
