import "server-only";
import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Per-category byte totals for the authenticated user's ready files.
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("files")
    .select("category, size_bytes")
    .eq("owner_id", user.id)
    .eq("status", "ready")
    .is("trashed_at", null);
  if (error) throw error;

  const byCat = new Map<string, { bytes: number; count: number }>();
  (data ?? []).forEach((r) => {
    const cat = String(r.category);
    const cur = byCat.get(cat) ?? { bytes: 0, count: 0 };
    cur.bytes += Number(r.size_bytes || 0);
    cur.count += 1;
    byCat.set(cat, cur);
  });
  const order = ["image", "video", "audio", "pdf", "document", "archive", "other"];
  return order.filter((c) => byCat.has(c)).map((c) => ({ category: c, ...byCat.get(c)! }));
});
