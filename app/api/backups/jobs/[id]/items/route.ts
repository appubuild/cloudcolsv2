import "server-only";
import { limited, handler, requireUser, ApiError, DEFAULT_LIMITS } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { id: string };

const VALID_STATUS = new Set([
  "queued",
  "uploading",
  "waitingWifi",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

// Register a new item on an existing job (e.g. newly discovered files).
interface CreateBody {
  filename: string;
  relativePath?: string;
  localIdentifier?: string;
  mimeType?: string;
  sizeBytes?: number;
}
export const POST = limited(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const body = (await req.json()) as CreateBody;
  if (!body.filename?.trim()) throw new ApiError("INVALID_INPUT", 400, "filename is required.");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("backup_job_items")
    .insert({
      job_id: id,
      owner_id: user.id,
      filename: body.filename.trim(),
      relative_path: body.relativePath ?? body.filename.trim(),
      local_identifier: body.localIdentifier ?? null,
      mime_type: body.mimeType ?? null,
      size_bytes: body.sizeBytes ?? 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  return {
    id: String(data.id),
    filename: String(data.filename),
    status: String(data.status),
  };
}, DEFAULT_LIMITS.backupItem);

// Update an item's status (and/or its uploaded file reference).
interface PatchBody {
  status?: string;
  progress?: number;
  errorMessage?: string | null;
  fileId?: string;
}
export const PATCH = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id: jobId } = (await ctx?.params) ?? { id: "" };
  const url = new URL(req.url);
  const itemId = url.searchParams.get("item");
  if (!itemId) throw new ApiError("INVALID_INPUT", 400, "item param is required.");
  const body = (await req.json()) as PatchBody;
  const admin = createAdminClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.status === "string" && VALID_STATUS.has(body.status)) updates.status = body.status;
  if (typeof body.progress === "number" && Number.isFinite(body.progress)) {
    updates.progress = Math.max(0, Math.min(1, body.progress));
  }
  if (body.errorMessage !== undefined) updates.error_message = body.errorMessage;
  if (typeof body.fileId === "string") updates.file_id = body.fileId;
  const { data, error } = await admin
    .from("backup_job_items")
    .update(updates)
    .eq("id", itemId)
    .eq("job_id", jobId)
    .eq("owner_id", user.id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("BACKUP_ITEM_NOT_FOUND", 404, "Backup item not found.");
  return {
    id: String(data.id),
    status: String(data.status),
    progress: Number(data.progress ?? 0),
  };
});
