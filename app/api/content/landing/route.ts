import "server-only";
import { handler, ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";
import { getLanding, mergeDefaults, type Landing } from "@/lib/content/landing";

export const dynamic = "force-dynamic";

// Public read of landing content (marketing page is public).
export const GET = handler(async () => getLanding());

interface Body extends Partial<Landing> {}

// Admin-only updates (super_admin or operator). Requires the admin token.
export const PATCH = handler(async (req: Request) => {
  await requireAdmin(req, "operator");
  const body = (await req.json()) as Body;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("site_content")
    .upsert(
      { key: "landing", content: body as never, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    )
    .select("content, updated_at")
    .single();
  if (error) throw new ApiError("CONTENT_UPDATE_FAILED", 500, error.message);
  const content = (data.content ?? {}) as Partial<Landing>;
  return mergeDefaults({ ...content, updatedAt: data.updated_at ?? null });
});
