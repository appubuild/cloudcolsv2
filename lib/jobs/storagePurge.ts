// Emptying the storage of deleted accounts (migration 0025).
//
// The delete route removes the account and queues its prefix; this removes the bytes.
// Separately, because a large account is thousands of storage calls and one request
// cannot make them. Each run spends a bounded budget and leaves the rest for the next.
//
// Destructive by design, so it refuses anything it cannot prove belongs to a deleted
// account:
//
//   - the prefix must be exactly "<uuid>/" — one account's folder, never a parent of it
//   - Auth must say that user does not exist. An account that still exists is never
//     purged, whatever the queue says; and "could not ask" is not "does not exist".

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { deleteObject, listObjects, listTopLevelPrefixes } from "@/lib/services/b2";
import { audit } from "@/lib/api/audit";

/**
 * Storage calls one run may make. An operational bound, not a product setting: it keeps
 * a run well inside the Worker's per-invocation subrequest limit.
 */
const DELETE_BUDGET = 400;

const ACCOUNT_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/i;

type AccountState = "gone" | "exists" | "unknown";

async function accountState(userId: string): Promise<AccountState> {
  const { data, error } = await createAdminClient().auth.admin.getUserById(userId);
  if (data?.user) return "exists";
  if (error && (error as { status?: number }).status === 404) return "gone";
  return "unknown";
}

/**
 * Finds account folders whose account is gone, and queues them for the purge above.
 *
 * The queue only hears about deletions made through the delete route. Everything
 * deleted before that route queued anything — and any account removed another way,
 * from the dashboard or a test script — left its folder behind with nothing pointing
 * at it. This finds those.
 *
 * It only queues; runStoragePurge still refuses any folder whose account exists, so a
 * mistake here costs a wasted queue row, not someone's files.
 */
export async function runOrphanSweep(): Promise<string> {
  const admin = createAdminClient();
  const prefixes = (await listTopLevelPrefixes()).filter((p) => ACCOUNT_PREFIX.test(p));

  // Bulk first: an account with a user_storage row certainly exists. Only folders
  // without one are asked about individually, which keeps this to a handful of calls.
  const missing: string[] = [];
  for (let i = 0; i < prefixes.length; i += 100) {
    const chunk = prefixes.slice(i, i + 100);
    const ids = chunk.map((p) => p.slice(0, -1));
    const { data, error } = await admin.from("user_storage").select("user_id").in("user_id", ids);
    if (error) return `Orphan sweep failed: ${error.message}`;
    const present = new Set((data ?? []).map((r) => String(r.user_id).toLowerCase()));
    for (const p of chunk) if (!present.has(p.slice(0, -1).toLowerCase())) missing.push(p);
  }

  let queued = 0;
  for (const prefix of missing.slice(0, 100)) {
    if ((await accountState(prefix.slice(0, -1))) !== "gone") continue;
    const { error } = await admin
      .from("storage_purge_queue")
      .upsert({ prefix, reason: "orphaned" }, { onConflict: "prefix", ignoreDuplicates: true });
    if (!error) queued += 1;
  }

  await audit({
    actorType: "system",
    action: "job.orphan_sweep",
    targetType: "job",
    targetId: "orphan-sweep",
    metadata: { folders: prefixes.length, withoutProfile: missing.length, queued },
  });

  return `Orphan sweep found ${prefixes.length} account folder(s); ${missing.length} without a profile; queued ${queued} whose account no longer exists.`;
}

export async function runStoragePurge(): Promise<string> {
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("storage_purge_queue")
    .select("prefix, attempts")
    .order("enqueued_at", { ascending: true })
    .limit(20);
  if (error) return `Storage purge failed: ${error.message}`;

  let budget = DELETE_BUDGET;
  let deleted = 0;
  let finished = 0;
  const refused: string[] = [];

  for (const row of rows ?? []) {
    if (budget <= 0) break;
    const prefix = String(row.prefix);

    if (!ACCOUNT_PREFIX.test(prefix)) {
      console.error("[purge] refusing a prefix that is not one account's folder", prefix);
      await admin.from("storage_purge_queue").delete().eq("prefix", prefix);
      refused.push(prefix);
      continue;
    }

    const state = await accountState(prefix.slice(0, -1));
    if (state === "exists") {
      console.error("[purge] account still exists; not purging", prefix);
      await admin.from("storage_purge_queue").delete().eq("prefix", prefix);
      refused.push(prefix);
      continue;
    }
    if (state === "unknown") continue; // try again next run

    try {
      const keys = await listObjects(prefix, Math.min(budget, 1000));
      budget -= 1;
      for (const key of keys) {
        await deleteObject(key);
      }
      budget -= keys.length;
      deleted += keys.length;
      if (keys.length === 0) {
        await admin.from("storage_purge_queue").delete().eq("prefix", prefix);
        finished += 1;
      }
    } catch (e) {
      await admin
        .from("storage_purge_queue")
        .update({ attempts: Number(row.attempts ?? 0) + 1, last_error: (e as Error).message.slice(0, 500) })
        .eq("prefix", prefix);
    }
  }

  await audit({
    actorType: "system",
    action: "job.storage_purge",
    targetType: "job",
    targetId: "storage-purge",
    metadata: { deleted, finished, refused: refused.length },
  });

  return `Storage purge deleted ${deleted} object(s); ${finished} account folder(s) emptied${refused.length ? `; refused ${refused.length}` : ""}.`;
}
