import "server-only";
import { ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { devRoute, devOptions, pageParams, publicFile, publicFolder } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** GET /v1/folders/:id — the folder, its subfolders, and a page of its files. */
export const GET = devRoute<Params, unknown>({ scope: "files.read" }, async (req, { identity, params }) => {
  const admin = createAdminClient();
  const { data: folder } = await admin
    .from("folders")
    .select("*")
    .eq("id", params.id)
    .eq("owner_id", identity.userId)
    .is("trashed_at", null)
    .maybeSingle();
  if (!folder) throw new ApiError("FOLDER_NOT_FOUND", 404, "Folder not found.");

  const { limit, offset } = pageParams(new URL(req.url));
  const [{ data: children }, { data: files, count }] = await Promise.all([
    admin
      .from("folders")
      .select("*")
      .eq("owner_id", identity.userId)
      .eq("parent_id", params.id)
      .is("trashed_at", null)
      .order("name"),
    admin
      .from("files")
      .select("*", { count: "exact" })
      .eq("owner_id", identity.userId)
      .eq("folder_id", params.id)
      .eq("status", "ready")
      .is("trashed_at", null)
      .order("original_filename")
      .range(offset, offset + limit - 1),
  ]);

  return {
    folder: publicFolder(folder as Record<string, unknown>),
    folders: (children ?? []).map((r) => publicFolder(r as Record<string, unknown>)),
    files: (files ?? []).map((r) => publicFile(r as Record<string, unknown>)),
    totalFiles: count ?? 0,
    limit,
    offset,
  };
});

export const OPTIONS = devOptions();
