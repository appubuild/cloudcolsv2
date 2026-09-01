import "server-only";
import { handler, limited, requireUser, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const JOB_STATUSES = [
  "queued",
  "uploading",
  "waitingWifi",
  "paused",
  "completed",
  "failed",
  "cancelled",
];

function mapJob(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    destinationFolder: row.destination_folder ? String(row.destination_folder) : null,
    totalBytes: Number(row.total_bytes ?? 0),
    uploadedBytes: Number(row.uploaded_bytes ?? 0),
    totalItems: Number(row.total_items ?? 0),
    uploadedItems: Number(row.uploaded_items ?? 0),
    wifiOnly: Boolean(row.wifi_only),
    status: String(row.status ?? "queued"),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

// List the user's backup jobs (most recent first). Options:
//   ?status=active|completed|failed|waiting  (optional filter)
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const admin = createAdminClient();
  let q = admin
    .from("backup_jobs")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  if (statusFilter === "active") {
    q = q.in("status", ["queued", "uploading", "waitingWifi", "paused"]);
  } else if (statusFilter && statusFilter !== "all") {
    q = q.eq("status", statusFilter);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => mapJob(r));
});

interface Body {
  name: string;
  destinationFolder?: string;
  totalBytes?: number;
  totalItems?: number;
  wifiOnly?: boolean;
  items?: BackupItemBody[];
}

interface BackupItemBody {
  filename: string;
  relativePath?: string;
  localIdentifier?: string;
  mimeType?: string;
  sizeBytes?: number;
}

// Create a backup job, optionally seeding its items in the same transaction.
// Rate-limited by IP because it can be abused to create many rows.
export const POST = limited(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  const name = body.name?.trim();
  if (!name) throw new ApiError("INVALID_INPUT", 400, "Job name is required.");
  if (!Array.isArray(body.items)) throw new ApiError("INVALID_INPUT", 400, "items must be an array.");

  const admin = createAdminClient();
  const inserted = await admin.rpc("create_backup_job", {
    p_owner_id: user.id,
    p_name: name,
    p_destination_folder: body.destinationFolder ?? null,
    p_total_bytes: body.totalBytes ?? 0,
    p_total_items: body.totalItems ?? body.items.length,
    p_wifi_only: body.wifiOnly ?? true,
    p_items: (body.items ?? []).map((i: BackupItemBody) => ({
      filename: i.filename,
      relative_path: i.relativePath ?? i.filename,
      local_identifier: i.localIdentifier ?? null,
      mime_type: i.mimeType ?? null,
      size_bytes: i.sizeBytes ?? 0,
    })),
  });
  if (inserted.error) throw new ApiError("BACKUP_JOB_FAILED", 500, inserted.error.message);

  const job = inserted.data?.[0] as Record<string, unknown> | undefined;
  if (!job) throw new ApiError("BACKUP_JOB_FAILED", 500, "Could not create backup job.");
  return mapJob(job);
}, DEFAULT_LIMITS.backupJob);
