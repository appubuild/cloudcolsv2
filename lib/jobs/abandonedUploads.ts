// Sweeping up uploads that were started and never finished.
//
// An upload creates a `pending` file row first, then sends the bytes, then confirms.
// Anything that interrupts the middle step — a closed tab, a dropped connection, a
// broken deploy — leaves the row behind. The row is invisible in every listing, so
// nobody ever sees it, and nothing existed to remove it.
//
// Multipart leaves more than a row. Parts already sent stay in the bucket until the
// upload is completed or aborted, and Backblaze bills for them the whole time. They
// are invisible too: they belong to no object, so listing the bucket does not show
// them. Two were found by hand this week, several hundred megabytes between them.
//
// So this job removes both, for anything older than the window: the stale rows, any
// object a half-finished upload did land, and every multipart upload still open past
// its time. Deliberately cautious — the window has to be long enough that a slow
// upload in progress is never mistaken for an abandoned one.

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { deleteObject, headObject, listMultipartUploads, abortMultipartUpload } from "@/lib/services/b2";
import { audit } from "@/lib/api/audit";
import { getSetting } from "@/lib/settings/system";

export async function runAbandonedUploads(): Promise<string> {
  const hours = await getSetting("abandoned_upload_hours");
  const cutoff = new Date(Date.now() - hours * 3600_000);
  const admin = createAdminClient();

  // --- pending rows ---------------------------------------------------------
  const { data: stale, error } = await admin
    .from("files")
    .select("id, object_key, original_filename")
    .eq("status", "pending")
    .lt("created_at", cutoff.toISOString());

  if (error) return `Abandoned uploads failed: ${error.message}`;

  let rows = 0;
  let objects = 0;
  for (const file of stale ?? []) {
    const key = String(file.object_key);
    // The bytes may or may not have landed; a pending row says only that they were
    // expected. Ask storage rather than assuming either way.
    const present = await headObject(key).catch(() => null);
    if (present) {
      await deleteObject(key);
      objects += 1;
    }
    await admin.from("files").delete().eq("id", String(file.id));
    rows += 1;
  }

  // --- unfinished multipart uploads -----------------------------------------
  let aborted = 0;
  try {
    for (const upload of await listMultipartUploads()) {
      if (upload.initiated && upload.initiated >= cutoff) continue;
      await abortMultipartUpload(upload.key, upload.uploadId);
      aborted += 1;
    }
  } catch (e) {
    // Storage refused the listing. The rows above are still worth having removed, and
    // the next run will try again.
    console.error("[jobs] listing multipart uploads failed", (e as Error).message);
  }

  await audit({
    actorType: "system",
    action: "job.abandoned_uploads",
    targetType: "job",
    targetId: "abandoned-uploads",
    metadata: { rows, objects, aborted, hours },
  });

  return `Removed ${rows} abandoned upload row(s), ${objects} orphaned object(s), and aborted ${aborted} unfinished multipart upload(s) older than ${hours}h.`;
}
