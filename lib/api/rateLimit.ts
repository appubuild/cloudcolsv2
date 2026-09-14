// Sliding-window rate limiting.
//
// On Cloudflare the count lives in a Durable Object (RateLimiter, in worker/index.mjs),
// one instance per key. That is the only place it can live and be correct. A Worker
// runs as many isolates at once, in many locations, and each has its own memory — so
// a limit held in memory was a limit per isolate: ten login attempts a minute became
// ten times however many isolates the attacker's requests happened to land on, and a
// fresh isolate started every count at zero. A Durable Object is a single instance
// worldwide for its name, so every request for a key is counted in one place.
//
// The in-memory limiter is kept as the fallback: under next dev and vitest there is no
// binding, and if the Durable Object cannot be reached the request is still limited
// locally rather than not at all. Failing open entirely would make an outage of the
// limiter an outage of the limit; failing closed would make it an outage of login.

import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetInSeconds: number;
}

interface RateLimiterStub {
  hit(limit: number, windowMs: number): Promise<RateLimitResult>;
}

interface RateLimiterNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): RateLimiterStub;
}

function limiterBinding(): RateLimiterNamespace | null {
  try {
    const env = getCloudflareContext()?.env as Record<string, unknown> | undefined;
    const ns = env?.RATE_LIMITER as RateLimiterNamespace | undefined;
    return ns && typeof ns.idFromName === "function" ? ns : null;
  } catch {
    return null;
  }
}

/**
 * Check + record a request against `key` with a per-window limit.
 * Returns whether the request is allowed and how many are remaining in window.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const ns = limiterBinding();
  if (ns) {
    try {
      return await ns.get(ns.idFromName(key)).hit(limit, windowMs);
    } catch (e) {
      console.error("[ratelimit] durable object unavailable; limiting locally", (e as Error).message);
    }
  }
  return checkRateLimitLocal(key, limit, windowMs);
}

/** Convenience for a per-minute limit. */
export function checkPerMinute(key: string, limit: number): Promise<RateLimitResult> {
  return checkRateLimit(key, limit, 60_000);
}

// --- in-memory fallback -------------------------------------------------------

type Bucket = { timestamps: number[] };

const store = new Map<string, Bucket>();
// Prune old buckets periodically so the map does not grow unbounded.
let lastPrune = Date.now();

function prune(windowMs: number) {
  const now = Date.now();
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [key, b] of store) {
    b.timestamps = b.timestamps.filter((t) => now - t < Math.max(windowMs, 60_000));
    if (b.timestamps.length === 0) store.delete(key);
  }
}

/**
 * The same sliding window, held in this isolate's memory. The Durable Object runs this
 * exact algorithm (worker/index.mjs); keep the two in step.
 */
export function checkRateLimitLocal(key: string, limit: number, windowMs: number): RateLimitResult {
  prune(windowMs);
  const now = Date.now();
  const bucket = store.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  const used = bucket.timestamps.length;

  const allowed = used < limit;
  if (allowed) {
    bucket.timestamps.push(now);
    store.set(key, bucket);
  }

  const oldest = bucket.timestamps.length ? bucket.timestamps[0]! : now;
  const resetInSeconds = Math.max(0, Math.ceil((windowMs - (now - oldest)) / 1000));

  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - used - (allowed ? 1 : 0)),
    resetInSeconds,
  };
}

/** Resets all local state (used in tests). */
export function resetRateLimit(): void {
  store.clear();
  lastPrune = Date.now();
}
