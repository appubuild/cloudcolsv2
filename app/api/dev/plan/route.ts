import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { accountApiPlan, setAccountApiPlan } from "@/lib/api/apiPlan";
import { usedThisMonth } from "@/lib/api/developer";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

/** The account's Developer API plan, and what it has used this month. */
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const planId = await accountApiPlan(user.id);

  const [{ data: plan }, requestsThisMonth, { count: keys }] = await Promise.all([
    admin.from("api_plans").select("*").eq("id", planId).maybeSingle(),
    usedThisMonth(user.id),
    admin.from("api_keys").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "active"),
  ]);

  return {
    planId,
    planName: plan?.name ? String(plan.name) : planId,
    priceCents: Number(plan?.price_cents ?? 0),
    rateLimitPerMinute: Number(plan?.rate_limit_per_minute ?? 60),
    requestsPerMonth: Number(plan?.requests_per_month ?? 0),
    requestsThisMonth,
    activeKeys: keys ?? 0,
  };
});

interface Body {
  planId?: string;
}

/**
 * Changes the account's Developer API plan.
 *
 * Only to a free one. A paid plan is money, and the only things that may grant one are
 * a payment provider confirming a charge or an admin — never an endpoint the account
 * itself calls. The billing page says as much rather than offering a button that would
 * be refused here.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as Body;
  const planId = String(body.planId ?? "").trim();
  if (!planId) throw new ApiError("INVALID_INPUT", 400, "planId is required.");

  const admin = createAdminClient();
  const { data: plan } = await admin.from("api_plans").select("*").eq("id", planId).maybeSingle();
  if (!plan || !plan.is_active) throw new ApiError("PLAN_UNAVAILABLE", 409, "That plan is not available.");
  if (Number(plan.price_cents ?? 0) > 0) {
    throw new ApiError(
      "PAYMENT_REQUIRED",
      402,
      "Paid Developer plans are not self-serve yet. Contact support and we will move your account across.",
    );
  }

  await setAccountApiPlan(user.id, planId);
  await audit({
    actorId: user.id,
    actorType: "user",
    action: "api_plan.changed",
    targetType: "user",
    targetId: user.id,
    metadata: { planId },
  });

  return { planId };
});
