import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { mapFile } from "@/lib/api/mappers";
import { deleteObject } from "@/lib/services/b2";
import { deliver } from "@/lib/jobs/webhookDelivery";
import { runAfterResponse } from "@/lib/api/background";

export const dynamic = "force-dynamic";

type Params = { id: string };

function fileQuery(admin: ReturnType<typeof createAdminClient>, id: string, userId: string) {
  return admin.from("files").select("*").eq("id", id).eq("owner_id", userId);
}

function fileUpdate(admin: ReturnType<typeof createAdminClient>, id: string, userId: string, updates: Record<string, unknown>) {
  return admin.from("files").update(updates).eq("id", id).eq("owner_id", userId);
}

// GET /api/files/:id — metadata
export const GET = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const admin = createAdminClient();
  const { data, error } = await fileQuery(admin, id, user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");
  return mapFile(data);
});

// PATCH /api/files/:id — rename / favorite / move
interface Body {
  originalFilename?: string;
  isFavorite?: boolean;
  folderId?: string | null;
}
export const PATCH = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const body = (await req.json()) as Body;
  const admin = createAdminClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.originalFilename === "string" && body.originalFilename.trim()) updates.original_filename = body.originalFilename.trim();
  if (typeof body.isFavorite === "boolean") updates.is_favorite = body.isFavorite;
  if ("folderId" in body) updates.folder_id = body.folderId;
  if (Object.keys(updates).length === 1) throw new ApiError("INVALID_INPUT", 400, "No changes provided.");

  // maybeSingle, not single. `single()` treats "no rows" as an error — PGRST116 —
  // and this rethrows it, so a PATCH against a file belonging to someone else came
  // back 500 with a Postgres error code instead of 404. Nothing was modified, so the
  // refusal was sound; it just announced itself as a server fault and put a database
  // error in the response. The FILE_NOT_FOUND branch below was unreachable.
  const { data, error } = await fileUpdate(admin, id, user.id, updates).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");
  return mapFile(data);
});

// DELETE /api/files/:id — soft delete (to trash) or permanent if ?force=true
export const DELETE = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";
  const admin = createAdminClient();
  const { data: file } = await fileQuery(admin, id, user.id).maybeSingle();
  if (!file) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");

  if (force) {
    await deleteObject(String(file.object_key));
    // The thumbnail is a separate object and would otherwise be billed forever with
    // nothing pointing at it.
    if (file.thumbnail_url) await deleteObject(String(file.thumbnail_url)).catch(() => {});
    await admin.from("files").delete().eq("id", id).eq("owner_id", user.id);
  } else {
    await admin.from("files").update({ trashed_at: new Date().toISOString() }).eq("id", id).eq("owner_id", user.id);
  }
  runAfterResponse(
    deliver(
      {
        id: String(file.id),
        type: force ? "file.deleted" : "file.trashed",
        fileId: String(file.id),
        objectKey: String(file.object_key),
        ownerId: user.id,
        timestamp: new Date().toISOString(),
      },
      user.id,
    ),
    `webhook file.${force ? "deleted" : "trashed"}`,
  );
  return { deleted: true, permanent: force };
});
