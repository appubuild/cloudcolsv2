// Work that should happen, but that the caller should not wait for.
//
// Recording that a file was opened is bookkeeping. Doing it before the URL is handed
// back puts two database round trips in front of the first frame of a video — the
// person is waiting on a write they will never look at.
//
// `waitUntil` is what a Worker offers for exactly this: the response goes out now and
// the promise keeps running afterwards. Without it, returning early would mean the
// isolate is torn down mid-write and the work is silently lost — which is worse than
// the delay it was meant to remove.

import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Runs `work` without blocking the response.
 *
 * Failures are swallowed on purpose. Nothing deferred here is something the caller
 * asked for, so a failed activity row must not turn a working download into an error.
 * Outside a Workers runtime — `next dev`, tests — it simply awaits, because there is
 * no response lifetime to outlive.
 */
export function defer(work: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await work();
    } catch {
      // Bookkeeping. Never the reason a request fails.
    }
  };

  try {
    const ctx = getCloudflareContext()?.ctx;
    if (ctx?.waitUntil) {
      ctx.waitUntil(run());
      return;
    }
  } catch {
    // Not a Workers runtime, or called outside a request.
  }

  void run();
}
