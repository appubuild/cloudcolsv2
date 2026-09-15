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
/**
 * Every job, once. The type and the run endpoint's allow-list both come from this.
 * The endpoint used to keep its own copy, which fell behind: abandoned-uploads was
 * scheduled daily and refused as "Unknown job" on every run, with nothing to say so.
 */
export const JOB_NAMES = [
  "webhook-delivery",
  "trash-cleanup",
  "inactivity",
  "abandoned-uploads",
  "storage-purge",
  "orphan-sweep",
] as const;

export type JobName = (typeof JOB_NAMES)[number];

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
      case "abandoned-uploads": {
        const { runAbandonedUploads } = await import("./abandonedUploads");
        const result = await runAbandonedUploads();
        return { name, ok: true, message: result };
      }
      case "orphan-sweep": {
        const { runOrphanSweep } = await import("./storagePurge");
        const result = await runOrphanSweep();
        return { name, ok: true, message: result };
      }
      case "storage-purge": {
        const { runStoragePurge } = await import("./storagePurge");
        const result = await runStoragePurge();
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
