// Work that outlives the response.
//
// A Worker is not a server: once the response is returned, the isolate can be
// stopped, and any promise still in flight is cancelled. Code written for Node —
// `doSomethingSlow().catch(() => {})` after the return — appears to work in
// development, where the process keeps running, and silently does nothing in
// production.
//
// `ctx.waitUntil` is how a Worker says "return this response, but stay alive until
// that finishes".

import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Keeps the isolate alive until `work` settles, where the runtime supports it.
 *
 * Falls back to letting the promise run loose — under `next dev` and in tests there
 * is no Worker context and the process is not going anywhere, so that is correct
 * there and merely best-effort nowhere else.
 *
 * Errors are swallowed on purpose: this is for work whose failure must not affect
 * the response that has already been sent. Callers that need to know about a failure
 * should await instead.
 */
export function runAfterResponse(work: Promise<unknown>, label: string): void {
  const swallowed = work.catch((error) => {
    console.error(`[background] ${label} failed`, error instanceof Error ? error.message : error);
  });

  try {
    const ctx = getCloudflareContext()?.ctx;
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(swallowed);
      return;
    }
  } catch {
    // Not a Workers runtime, or called outside a request.
  }

  void swallowed;
}
