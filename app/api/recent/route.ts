import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { mapFile, mapFolder } from "@/lib/api/mappers";
import type { FileListItem } from "@/lib/types";

export const dynamic = "force-dynamic";

// Combined "Recent Access" — the most recently opened/edited files AND folders,
// newest first, for the dashboard. Simulated access is updated via POST /api/recent.
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const limit = Math.min(30, Number(url.searchParams.get("limit") ?? 10));
  const admin = createAdminClient();

  const [filesRes, foldersRes] = await Promise.all([
    admin.from("files").select("*").eq("owner_id", user.id).is("trashed_at", null).not("last_accessed_at", "is", null).order("last_accessed_at", { ascending: false }).limit(limit),
    admin.from("folders").select("*").eq("owner_id", user.id).is("trashed_at", null).not("last_accessed_at", "is", null).order("last_accessed_at", { ascending: false }).limit(limit),
  ]);

  const items: (FileListItem & { accessedAt: string })[] = [
    ...(filesRes.data ?? []).map((r) => ({ ...mapFile(r as Record<string, unknown>), accessedAt: String(r.last_accessed_at) })),
    ...(foldersRes.data ?? []).map((r) => ({ ...mapFolder(r as Record<string, unknown>), accessedAt: String(r.last_accessed_at) })),
  ].sort((a, b) => b.accessedAt.localeCompare(a.accessedAt)).slice(0, limit);

  return { items, total: items.length };
});

// Mark a file or folder as accessed (updates last_accessed_at).
interface Body { type: "file" | "folder"; id: string }
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;
  if (!body.id || (body.type !== "file" && body.type !== "folder")) {
    throw new ApiError("INVALID_INPUT", 400, "type (file|folder) and id are required.");
  }
  const admin = createAdminClient();
  const table = body.type === "file" ? "files" : "folders";
  const now = new Date().toISOString();
  const { error } = await admin.from(table).update({ last_accessed_at: now }).eq("id", body.id).eq("owner_id", user.id);
  if (error) throw error;
  return { accessedAt: now };
});
