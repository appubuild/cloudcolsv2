// Server-side crypto helpers: secure key generation + hashing, HMAC signing.
// Used for API keys (hashed at rest) and webhook signature verification.

import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

/** Generate a cryptographically-secure random hex string. */
export function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

/** Hash a secret for storage. Never store raw secrets. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Constant-time comparison of two hash strings. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Generate a new API key and return the raw (shown once) + the hash (stored). */
export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `cc_live_${randomBytes(24).toString("base64url")}`;
  const prefix = raw.slice(0, 14); // for display only
  return { raw, prefix, hash: hashSecret(raw) };
}

/** HMAC-SHA256 signature of a payload with a secret, returned as hex. */
export function hmacSign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Verify an HMAC signature in constant time. */
export function hmacVerify(secret: string, payload: string, signature: string): boolean {
  const expected = hmacSign(secret, payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
