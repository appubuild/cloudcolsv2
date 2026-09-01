// Trash cleanup job.
// Deletes objects that have been in the trash beyond the retention window
// (configurable; default 30 days). Runs asynchronously; never in a request.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { deleteObject } from "@/lib/services/b2";
import { audit } from "@/lib/api/audit";

export function trashRetentionDays(): number {
  const v = Number(process.env.TRASH_RETENTION_DAYS ?? 30);
  return Number.isFinite(v) && v > 0 ? v : 30;
}

export async function runTrashCleanup(): Promise<string> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - trashRetentionDays() * 86400000).toISOString();
  const { data, error } = await admin
    .from("files")
    .select("id, object_key, owner_id")
    .not("trashed_at", "is", null)
    .lt("trashed_at", cutoff);

  let deleted = 0;
  if (error) return `Trash cleanup failed: ${error.message}`;

  for (const file of (data ?? [])) {
    await deleteObject(String(file.object_key));
    await admin.from("files").delete().eq("id", String(file.id));
    deleted += 1;
  }
  // Folders too.
  const { data: folders } = await admin
    .from("folders")
    .select("id")
    .not("trashed_at", "is", null)
    .lt("trashed_at", cutoff);
  for (const f of (folders ?? [])) {
    await admin.from("folders").delete().eq("id", String(f.id));
  }

  await audit({ actorType: "system", action: "job.trash_cleanup", targetType: "job", targetId: "trash-cleanup", metadata: { deleted, retentionDays: trashRetentionDays() } });
  return `Trash cleanup removed ${deleted} file(s) older than ${trashRetentionDays()} days.`;
}
