// Background job framework.
// Jobs are async and side-impactful; they run outside the request lifecycle so
// heavy work never blocks a normal API request (per the brief). In production
// they are triggered by a scheduled function / cron / worker. The same handlers
// can be invoked on demand via POST /api/jobs/run for local development.

import "server-only";
import { audit } from "@/lib/api/audit";

/**
 * "thumbnail" used to be one of these. The job it ran wrote a thumbnail_url pointing
 * at a derivative it never created — nothing in a Worker can resize an image — and
 * parked video and audio in "processing" on the way. Thumbnails are made in the
 * browser at upload time now (lib/services/thumbnailer.ts), so there is no job.
 */
export type JobName = "webhook-delivery" | "trash-cleanup" | "inactivity";

export interface JobContext {
  name: JobName;
  data?: Record<string, unknown>;
}

export async function runJob(name: JobName, data?: Record<string, unknown>): Promise<{ name: JobName; ok: boolean; message: string }> {
  try {
    switch (name) {
      case "inactivity": {
        const { runInactivityPolicy } = await import("./inactivity");
        const result = await runInactivityPolicy(data as never);
        return { name, ok: true, message: result };
      }
      case "trash-cleanup": {
        const { runTrashCleanup } = await import("./trashCleanup");
        const result = await runTrashCleanup();
        return { name, ok: true, message: result };
      }
      case "webhook-delivery": {
        const { runWebhookDelivery } = await import("./webhookDelivery");
        const result = await runWebhookDelivery(data as never);
        return { name, ok: true, message: result };
      }
      default:
        return { name, ok: false, message: "Unknown job." };
    }
  } catch (e) {
    await audit({ actorType: "system", action: `job.${name}_failed`, targetType: "job", targetId: name, metadata: { error: (e as Error).message } });
    return { name, ok: false, message: (e as Error).message };
  }
}
