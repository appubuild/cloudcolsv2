import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { mapFolder } from "@/lib/api/mappers";

export const dynamic = "force-dynamic";

type Params = { id: string };

interface Body {
  name?: string;
  parentId?: string | null;
  isFavorite?: boolean;
  toggleFavorite?: boolean;
  isPinned?: boolean;
  togglePin?: boolean;
  /** An icon key, or null to go back to the default folder. */
  icon?: string | null;
}

// The client owns what each key looks like; the server only accepts keys it knows,
// so a request cannot store something the UI will fail to render.
const ICON_KEYS = new Set([
  "folder",
  "work",
  "personal",
  "photos",
  "videos",
  "documents",
  "important",
  "projects",
]);

export const PATCH = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const body = (await req.json()) as Body;
  const admin = createAdminClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if ("parentId" in body) updates.parent_id = body.parentId;
  if (typeof body.isFavorite === "boolean") updates.is_favorite = body.isFavorite;
  // Server-side toggle (avoids the client needing current state).
  if (body.toggleFavorite) {
    const { data: cur } = await admin.from("folders").select("is_favorite").eq("id", id).eq("owner_id", user.id).maybeSingle();
    updates.is_favorite = cur ? !Boolean(cur.is_favorite) : true;
  }
  if (typeof body.isPinned === "boolean") updates.is_pinned = body.isPinned;
  if (body.togglePin) {
    const { data: cur } = await admin.from("folders").select("is_pinned").eq("id", id).eq("owner_id", user.id).maybeSingle();
    updates.is_pinned = cur ? !Boolean(cur.is_pinned) : true;
  }
  if ("icon" in body) {
    if (body.icon === null || body.icon === "folder") {
      updates.icon = null; // back to the default
    } else if (typeof body.icon === "string" && ICON_KEYS.has(body.icon)) {
      updates.icon = body.icon;
    } else {
      throw new ApiError("INVALID_INPUT", 400, "That is not a folder icon.");
    }
  }

  const { data, error } = await admin
    .from("folders")
    .update(updates)
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("*")
    .single();
  if (error) throw error;
  if (!data) throw new ApiError("FOLDER_NOT_FOUND", 404, "Folder not found.");
  return mapFolder(data as Record<string, unknown>);
});

export const DELETE = handler(async (req: Request, ctx?: { params: Promise<Params> }) => {
  const user = await requireUser(req);
  const { id } = (await ctx?.params) ?? { id: "" };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("folders")
    .update({ trashed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("*")
    .single();
  if (error) throw error;
  if (!data) throw new ApiError("FOLDER_NOT_FOUND", 404, "Folder not found.");
  return mapFolder(data as Record<string, unknown>);
});
