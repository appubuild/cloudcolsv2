import { handler, requireUser } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Aggregated request history for the developer portal usage dashboard.
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? 7)));
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_request_logs")
    .select("id, api_key_id, endpoint, method, status_code, response_time_ms, created_at")
    .eq("user_id", user.id)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const items = (data ?? []).map((r) => ({
    id: String(r.id),
    apiKeyId: String(r.api_key_id ?? ""),
    endpoint: String(r.endpoint),
    method: String(r.method),
    statusCode: Number(r.status_code),
    responseTimeMs: Number(r.response_time_ms),
    createdAt: String(r.created_at),
  }));
  return { items, total: items.length, page: 1, pageSize: items.length || 1 };
});
