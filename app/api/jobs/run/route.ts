import { handler, ApiError } from "@/lib/api/auth";
import { runJob } from "@/lib/jobs";
import type { JobName } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const ALLOWED: JobName[] = ["webhook-delivery", "thumbnail", "trash-cleanup", "inactivity"];

// Trigger a background job on demand (dev/scheduled). In production this is
// invoked by cron/Supabase scheduled functions.
interface Body { name: string; data?: Record<string, unknown> }
export const POST = handler(async (req: Request) => {
  // Scheduler-only: require the shared token in production. When JOBS_TOKEN is
  // unset (dev/mock) we allow it so local testing & PG-cron setup work.
  const token = process.env.JOBS_TOKEN;
  if (token) {
    const headerToken = req.headers.get("x-job-token") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (headerToken !== token) throw new ApiError("UNAUTHORIZED", 401, "Invalid jobs token.");
  }
  const body = (await req.json()) as Body;
  if (!ALLOWED.includes(body.name as JobName)) {
    return { ok: false, message: `Unknown job "${body.name}". Allowed: ${ALLOWED.join(", ")}` };
  }
  return runJob(body.name as JobName, body.data);
});
