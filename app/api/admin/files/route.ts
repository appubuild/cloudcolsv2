import "server-only";
import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Files across every account, for Storage Operations.
 *
 * That screen used to call the ordinary user hooks — `useFiles`, `useUsageSummary`
 * — which send the signed-in *user's* token and return that person's own files. A
 * page titled "Storage Operations", showing largest-files-first for the whole
 * platform, was in fact showing whichever end-user session happened to be in the
 * browser, and nothing on it said so.
 *
 * Metadata only. Nothing here returns file contents; that is
 * /api/admin/files/[fileId]/preview, which is separate and audits every use.
 */
const SORT_COLUMNS: Record<string, string> = {
  size: "size_bytes",
  created: "created_at",
  modified: "updated_at",
  name: "original_filename",
};

export const GET = handler(async (req: Request) => {
  const staff = await requireAdmin(req, "support");
  const client = createAdminClient();

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const category = url.searchParams.get("category");
  const search = (url.searchParams.get("search") ?? "").trim();
  const sort = url.searchParams.get("sort") ?? "size";
  const order = (url.searchParams.get("order") ?? "desc").toUpperCase();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Number(url.searchParams.get("pageSize") ?? 50));

  let query = client
    .from("files")
    .select("id, owner_id, original_filename, category, size_bytes, status, created_at, updated_at, trashed_at", {
      count: "exact",
    });

  if (status === "trashed") query = query.not("trashed_at", "is", null);
  else {
    query = query.is("trashed_at", null);
    if (status) query = query.eq("status", status);
  }
  if (category) query = query.eq("category", category);
  if (search) query = query.ilike("original_filename", `%${search}%`);

  // Mapped, so a caller-supplied string cannot become a column name.
  query = query.order(SORT_COLUMNS[sort] ?? SORT_COLUMNS.size, { ascending: order === "ASC", nullsFirst: false });

  const { data, count, error } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;

  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => String(r.owner_id)))];

  let emails: Record<string, string> = {};
  if (ids.length) {
    const { data: users } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    emails = Object.fromEntries(
      (users?.users ?? []).filter((u) => ids.includes(u.id)).map((u) => [u.id, u.email ?? ""]),
    );
  }
  const mask = (email: string) => (email ? `${email.slice(0, 2)}•••@•••` : "");

  return {
    items: rows.map((r) => ({
      id: String(r.id),
      ownerId: String(r.owner_id),
      ownerEmail: staff.role === "super_admin" ? (emails[String(r.owner_id)] ?? "") : mask(emails[String(r.owner_id)] ?? ""),
      originalFilename: String(r.original_filename),
      category: String(r.category ?? "other"),
      sizeBytes: Number(r.size_bytes ?? 0),
      status: String(r.status),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      trashedAt: r.trashed_at ? String(r.trashed_at) : null,
    })),
    total: count ?? rows.length,
    page,
    pageSize,
  };
});
