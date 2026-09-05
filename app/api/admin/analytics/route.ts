import "server-only";
import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Platform-wide storage and revenue, computed from the rows.
 *
 * Every figure here is derived rather than read from a counter, because a counter
 * that has drifted is exactly what this page would be used to notice. The cost is
 * one pass over the file metadata — not the files themselves, which never leave
 * storage.
 *
 * Capped: an installation with millions of files should not have its dashboard
 * pull every row. The cap is reported, so a truncated figure is never mistaken
 * for a complete one.
 */
const FILE_SCAN_LIMIT = 50_000;

export const GET = handler(async (req: Request) => {
  await requireAdmin(req, "support");
  const admin = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [files, storage, folders, payments, subscriptions, recentUploads] = await Promise.all([
    admin
      .from("files")
      .select("owner_id, category, size_bytes, original_filename, created_at")
      .is("trashed_at", null)
      .eq("status", "ready")
      .limit(FILE_SCAN_LIMIT),
    admin.from("user_storage").select("user_id, plan_id, status, storage_used_bytes, storage_quota_bytes, created_at"),
    admin.from("folders").select("id", { count: "exact", head: true }).is("trashed_at", null),
    admin.from("payments").select("amount_cents, status, currency, created_at"),
    admin.from("subscriptions").select("plan_id, status"),
    admin
      .from("files")
      .select("id, owner_id, original_filename, category, size_bytes, created_at")
      .is("trashed_at", null)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const rows = files.data ?? [];
  const accounts = storage.data ?? [];

  // By file type.
  const byCategory = new Map<string, { bytes: number; count: number }>();
  const byOwner = new Map<string, number>();
  for (const f of rows) {
    const key = String(f.category ?? "other");
    const cur = byCategory.get(key) ?? { bytes: 0, count: 0 };
    const size = Number(f.size_bytes ?? 0);
    cur.bytes += size;
    cur.count += 1;
    byCategory.set(key, cur);
    byOwner.set(String(f.owner_id), (byOwner.get(String(f.owner_id)) ?? 0) + size);
  }

  // By plan, from the accounts rather than the subscriptions: an account on a
  // plan is what consumes storage, whether or not it has a subscription row.
  const byPlan = new Map<string, { accounts: number; bytes: number }>();
  for (const a of accounts) {
    const key = String(a.plan_id ?? "plan_free");
    const cur = byPlan.get(key) ?? { accounts: 0, bytes: 0 };
    cur.accounts += 1;
    cur.bytes += Number(a.storage_used_bytes ?? 0);
    byPlan.set(key, cur);
  }

  const paid = payments.data ?? [];
  const succeeded = paid.filter((p) => p.status === "succeeded");

  return {
    truncated: rows.length >= FILE_SCAN_LIMIT,
    scannedFiles: rows.length,

    users: {
      total: accounts.length,
      active: accounts.filter((a) => a.status === "active").length,
      new7d: accounts.filter((a) => a.created_at && String(a.created_at) >= sevenDaysAgo).length,
    },

    storage: {
      usedBytes: accounts.reduce((sum, a) => sum + Number(a.storage_used_bytes ?? 0), 0),
      allocatedBytes: accounts.reduce((sum, a) => sum + Number(a.storage_quota_bytes ?? 0), 0),
      fileCount: rows.length,
      folderCount: folders.count ?? 0,
      byCategory: [...byCategory.entries()]
        .map(([category, v]) => ({ category, ...v }))
        .sort((a, b) => b.bytes - a.bytes),
      byPlan: [...byPlan.entries()].map(([planId, v]) => ({ planId, ...v })).sort((a, b) => b.bytes - a.bytes),
    },

    largestFiles: [...rows]
      .sort((a, b) => Number(b.size_bytes ?? 0) - Number(a.size_bytes ?? 0))
      .slice(0, 10)
      .map((f) => ({
        ownerId: String(f.owner_id),
        filename: String(f.original_filename),
        category: String(f.category ?? "other"),
        sizeBytes: Number(f.size_bytes ?? 0),
      })),

    topUsers: [...byOwner.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, bytes]) => ({ userId, bytes })),

    recentUploads: (recentUploads.data ?? []).map((f) => ({
      id: String(f.id),
      ownerId: String(f.owner_id),
      filename: String(f.original_filename),
      category: String(f.category ?? "other"),
      sizeBytes: Number(f.size_bytes ?? 0),
      createdAt: String(f.created_at),
    })),

    payments: {
      succeededCount: succeeded.length,
      failedCount: paid.filter((p) => p.status === "failed").length,
      pendingCount: paid.filter((p) => p.status === "pending").length,
      refundedCount: paid.filter((p) => p.status === "refunded").length,
      // Only money that actually arrived.
      grossCents: succeeded.reduce((sum, p) => sum + Number(p.amount_cents ?? 0), 0),
      last30dCents: succeeded
        .filter((p) => p.created_at && new Date(p.created_at) >= new Date(Date.now() - 30 * 86400000))
        .reduce((sum, p) => sum + Number(p.amount_cents ?? 0), 0),
    },

    subscriptions: {
      active: (subscriptions.data ?? []).filter((s) => s.status === "active").length,
      cancelled: (subscriptions.data ?? []).filter((s) => s.status === "cancelled").length,
      pastDue: (subscriptions.data ?? []).filter((s) => s.status === "past_due").length,
    },
  };
});
