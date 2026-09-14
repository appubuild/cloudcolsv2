/**
 * The deployed Worker: OpenNext's handler, plus a scheduled one.
 *
 * OpenNext generates a worker that exports only `fetch`. Cloudflare Cron Triggers
 * call `scheduled`, so without a wrapper there is nowhere for them to land — which
 * is why wrangler.jsonc had no crons and trash cleanup and the inactivity lifecycle
 * had never run in production even once. Both endpoints existed and were tested;
 * nothing was calling them.
 *
 * This file is the entry point. It re-exports the generated worker's Durable Object
 * classes, forwards `fetch` untouched, and adds `scheduled`.
 *
 * Deliberately plain JavaScript: `.open-next/worker.js` is a build artifact that
 * does not exist when `tsc --noEmit` runs, and a .ts file importing it would fail
 * typechecking on a clean checkout.
 */

import openNextWorker from "../.open-next/worker.js";

// The generated worker exports these; a Durable Object binding fails to start if the
// entry point does not.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js";

/**
 * Which jobs each schedule runs, keyed by the cron expression in wrangler.jsonc.
 *
 * Both of these delete things — trashed files past their retention, and accounts
 * past the inactivity grace period — so they run once a day, at a quiet hour, and
 * not more often. Nothing here is time-critical enough to justify a tighter loop
 * against work that is destructive by design.
 */
const SCHEDULES = {
  "17 3 * * *": ["trash-cleanup", "inactivity", "abandoned-uploads"],
};

export default {
  fetch: openNextWorker.fetch,

  /**
   * Runs the jobs due for this trigger.
   *
   * Goes through the Worker's own /api/jobs/run rather than importing the job
   * modules. Those modules read configuration through getCloudflareContext(), which
   * only exists inside a request — calling them from here would quietly fall back to
   * process.env and use defaults instead of what the deployment is configured with.
   * Dispatching to fetch keeps one code path, already tested, already audited.
   *
   * The call is in-process. Nothing leaves the Worker.
   */
  async scheduled(controller, env, ctx) {
    const jobs = SCHEDULES[controller.cron] ?? [];
    if (jobs.length === 0) {
      console.warn(`[cron] no jobs mapped to "${controller.cron}"`);
      return;
    }

    const token = env.JOBS_TOKEN;
    if (!token) {
      // The endpoint fails closed without it, so say why here rather than leaving a
      // run of 401s in the logs with no explanation.
      console.error("[cron] JOBS_TOKEN is not set; no jobs can run.");
      return;
    }

    // The origin is not used for routing — the Worker matches on pathname — but a
    // Request needs an absolute URL.
    const origin = env.NEXT_PUBLIC_APP_URL || "https://cloudcols.com";

    for (const name of jobs) {
      try {
        const request = new Request(`${origin}/api/jobs/run`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-job-token": token },
          body: JSON.stringify({ name }),
        });
        const response = await openNextWorker.fetch(request, env, ctx);
        const body = await response.text();
        console.log(`[cron] ${name} -> ${response.status} ${body.slice(0, 300)}`);
      } catch (error) {
        // One job failing must not stop the next. They are independent, and a
        // thrown error here would skip whatever came after it in the list.
        console.error(`[cron] ${name} threw`, error instanceof Error ? error.message : error);
      }
    }
  },
};
