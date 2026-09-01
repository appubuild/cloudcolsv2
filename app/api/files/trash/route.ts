import "server-only";
import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { mapFile, mapFolder } from "@/lib/api/mappers";

export const dynamic = "force-dynamic";

// List trashed items (files + folders) for the user.
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const [filesRes, foldersRes] = await Promise.all([
    admin.from("files").select("*").eq("owner_id", user.id).not("trashed_at", "is", null).order("trashed_at", { ascending: false }),
    admin.from("folders").select("*").eq("owner_id", user.id).not("trashed_at", "is", null).order("trashed_at", { ascending: false }),
  ]);
  const mappedFiles = (filesRes.data ?? []).map(mapFile);
  const mappedFolders = (foldersRes.data ?? []).map(mapFolder);
  const items = [...mappedFolders, ...mappedFiles].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { items, total: items.length, page: 1, pageSize: items.length || 1 };
});
