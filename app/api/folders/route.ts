import "server-only";
import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { mapFolder } from "@/lib/api/mappers";

export const dynamic = "force-dynamic";

// List all folders for the user (flat, for navigation/breadcrumbs / dashboard).
// Supports ?favorite=true (favorite folders) and ?recent=true (last-accessed).
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const favorite = url.searchParams.get("favorite") === "true";
  const recent = url.searchParams.get("recent") === "true";

  const admin = createAdminClient();
  let q = admin.from("folders").select("*").eq("owner_id", user.id).is("trashed_at", null);
  if (favorite) q = q.eq("is_favorite", true).order("name");
  else if (recent) q = q.not("last_accessed_at", "is", null).order("last_accessed_at", { ascending: false });
  else q = q.order("name");
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapFolder);
});

// Create a folder.
interface Body {
  parentId?: string | null;
  name: string;
}
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  const trimmed = body.name?.trim();
  if (!trimmed) throw new Error("Folder name is required.");

  const admin = createAdminClient();
  // Resolve breadcrumb path from parent if any.
  let path = trimmed;
  if (body.parentId) {
    const { data: parent } = await admin.from("folders").select("path").eq("id", body.parentId).eq("owner_id", user.id).maybeSingle();
    if (!parent) throw new Error("Parent folder not found.");
    path = `${parent.path} / ${trimmed}`;
  }
  const { data, error } = await admin
    .from("folders")
    .insert({ owner_id: user.id, parent_id: body.parentId ?? null, name: trimmed, path })
    .select("*")
    .single();
  if (error) throw error;
  return mapFolder(data);
});
