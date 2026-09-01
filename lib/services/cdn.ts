// CDN delivery helper (server-only).
// Generates short-lived signed tickets for the Cloudflare Worker (mode
// "ticket"), or falls back to the B2 public-domain URL when no signing secret
// is configured (e.g. local/mock dev). The client only ever holds a ticket —
// never the B2 keys.

import "server-only";
import { createHmac } from "crypto";

const TICKET_TTL_MS = 60 * 60 * 1000; // 1 hour

function ticketSecret(): string {
  return process.env.CDN_TICKET_SECRET ?? "";
}

/** Build a signed CDN ticket URL for the given object key. */
export function buildCdnUrl(objectKey: string): string | null {
  const secret = ticketSecret();
  const cdnDomain = process.env.CDN_DOMAIN;
  if (!secret || !cdnDomain) return null;

  const exp = Date.now() + TICKET_TTL_MS;
  const sig = createHmac("sha256", secret).update(`${objectKey}:${exp}`).digest("hex");
  const base = cdnDomain.endsWith("/") ? cdnDomain.slice(0, -1) : cdnDomain;
  return `${base}/v1/object?key=${encodeURIComponent(objectKey)}&exp=${exp}&sig=${sig}`;
}

/** Best-effort "ready to read" URL: signed ticket first, else B2 public URL. */
export function readableUrl(objectKey: string): string | null {
  const viaTicket = buildCdnUrl(objectKey);
  if (viaTicket) return viaTicket;
  const domain = process.env.B2_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}/${objectKey}`;
  const endpoint = process.env.B2_ENDPOINT;
  const bucket = process.env.B2_BUCKET;
  if (endpoint && bucket) return `${endpoint}/${bucket}/${objectKey}`;
  return null;
}
