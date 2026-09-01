import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { id: string };

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

const VALID_STATUS = new Set([
  "queued",
  "uploading",
  "waitingWifi",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const GET = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("backup_jobs")
    .select("*, backup_job_items(*)")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("BACKUP_JOB_NOT_FOUND", 404, "Backup job not found.");
  const items = (data.backup_job_items ?? []).map((i: Record<string, unknown>) => ({
    id: String(i.id),
    filename: String(i.filename),
    relativePath: i.relative_path ? String(i.relative_path) : null,
    mimeType: i.mime_type ? String(i.mime_type) : null,
    sizeBytes: Number(i.size_bytes ?? 0),
    status: String(i.status ?? "queued"),
    progress: Number(i.progress ?? 0),
    errorMessage: i.error_message ? String(i.error_message) : null,
  }));
  return { ...mapJob(data), items };
});

interface Body {
  status?: string;
  uploadedBytes?: number;
  uploadedItems?: number;
  errorMessage?: string | null;
  destinationFolder?: string;
}

// Progress/status updates from the app.
export const PATCH = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const body = (await req.json()) as Body;
  const admin = createAdminClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.status === "string" && VALID_STATUS.has(body.status)) {
    updates.status = body.status;
    if (body.status === "completed") updates.completed_at = new Date().toISOString();
  }
  if (Number.isFinite(body.uploadedBytes)) updates.uploaded_bytes = body.uploadedBytes;
  if (Number.isInteger(body.uploadedItems)) updates.uploaded_items = body.uploadedItems;
  if (body.errorMessage !== undefined) updates.error_message = body.errorMessage;
  if (typeof body.destinationFolder === "string") updates.destination_folder = body.destinationFolder;

  const { data, error } = await admin
    .from("backup_jobs")
    .update(updates)
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("BACKUP_JOB_NOT_FOUND", 404, "Backup job not found.");
  return mapJob(data as Record<string, unknown>);
});

export const DELETE = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const admin = createAdminClient();
  const { error } = await admin.from("backup_jobs").delete().eq("id", id).eq("owner_id", user.id);
  if (error) throw error;
  return { ok: true };
});
