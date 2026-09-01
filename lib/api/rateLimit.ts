// Simple, reliable sliding-window rate limiter (in-memory).
// Per the brief: introduce Redis only when actual scale justifies it. This
// keeps limits configurable without external dependencies. For a single
// server instance it is sufficient; for scale-out, swap the store for Redis
// while keeping the same interface.

import "server-only";

type Bucket = { timestamps: number[] };

const store = new Map<string, Bucket>();
// Prune old buckets periodically so the map does not grow unbounded.
let lastPrune = Date.now();

function prune() {
  const now = Date.now();
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [key, b] of store) {
    if (b.timestamps.length === 0) store.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetInSeconds: number;
}

/**
 * Check + record a request against `key` with a per-window limit.
 * Returns whether the request is allowed and how many are remaining in window.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  prune();
  const now = Date.now();
  const bucket = store.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  const used = bucket.timestamps.length;

  const allowed = used < limit;
  if (allowed) {
    bucket.timestamps.push(now);
    store.set(key, bucket);
  }

  const windowStart = Math.max(...bucket.timestamps, now);
  const maxUsedTs = bucket.timestamps.length ? bucket.timestamps[0] : now;
  const resetInSeconds = Math.max(0, Math.ceil((windowMs - (now - maxUsedTs)) / 1000));

  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - used - (allowed ? 1 : 0)),
    resetInSeconds,
  };
}

/** Convenience for a per-minute limit. */
export function checkPerMinute(key: string, limit: number): RateLimitResult {
  return checkRateLimit(key, limit, 60_000);
}

/** Resets all state (used in tests). */
export function resetRateLimit(): void {
  store.clear();
  lastPrune = Date.now();
}
