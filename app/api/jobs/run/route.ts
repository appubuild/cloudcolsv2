import { handler, ApiError } from "@/lib/api/auth";
import { runJob } from "@/lib/jobs";
import type { JobName } from "@/lib/jobs";
import { serverConfig } from "@/lib/config/server-env";
import { secretEqual } from "@/lib/api/crypto";

export const dynamic = "force-dynamic";

const ALLOWED: JobName[] = ["webhook-delivery", "trash-cleanup", "inactivity"];

/**
 * Runs a background job. Scheduler only.
 *
 * This used to skip the token check entirely when JOBS_TOKEN was unset, "so local
 * testing works". JOBS_TOKEN was unset. The jobs behind this endpoint delete
 * trashed files and drive the inactivity lifecycle that ends in deleting accounts,
 * so an unauthenticated POST could destroy other people's data.
 *
 * It now fails closed: no configured token means no job runs, anywhere. A missing
 * secret is a deployment mistake, and refusing is the only answer that cannot lose
 * data. The token is read through serverConfig because process.env alone does not
 * see Worker bindings — the previous code would have found nothing even after the
 * secret was set, and carried on running unauthenticated.
 */
interface Body {
  name: string;
  data?: Record<string, unknown>;
}

export const POST = handler(async (req: Request) => {
  const expected = serverConfig("JOBS_TOKEN");
  if (!expected) {
    throw new ApiError(
      "NOT_CONFIGURED",
      503,
      "JOBS_TOKEN is not set on this deployment. Background jobs are disabled until it is.",
    );
  }

  const presented =
    req.headers.get("x-job-token") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!secretEqual(presented, expected)) {
    throw new ApiError("UNAUTHORIZED", 401, "Invalid jobs token.");
  }

  const body = (await req.json()) as Body;
  if (!ALLOWED.includes(body.name as JobName)) {
    throw new ApiError("INVALID_INPUT", 400, `Unknown job "${body.name}". Allowed: ${ALLOWED.join(", ")}`);
  }
  return runJob(body.name as JobName, body.data);
});
