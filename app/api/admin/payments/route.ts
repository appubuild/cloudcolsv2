import { handler } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  await requireAdmin(req, "support");
  const admin = createAdminClient();
  const { data, error } = await admin.from("payments").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: String(p.id),
    userId: String(p.user_id),
    subscriptionId: p.subscription_id ? String(p.subscription_id) : null,
    amountCents: Number(p.amount_cents),
    currency: String(p.currency),
    provider: p.provider ? String(p.provider) : null,
    status: p.status as "succeeded" | "failed" | "refunded" | "pending",
    createdAt: String(p.created_at),
  }));
});
