import "server-only";
import { handler } from "@/lib/api/auth";
import { requirePlan } from "@/lib/plans/catalog";

export const dynamic = "force-dynamic";

/**
 * A single plan. `PlanRepository.get()` has always called this; the route did not
 * exist, so every call 404'd.
 *
 * Retired plans are returned here, unlike the list: an account still on one needs
 * to be able to render what it is on.
 */
type Params = { id: string };

export const GET = handler(async (_req: Request, ctx?: { params: Promise<Params> }) => {
  const { id } = (await ctx?.params) ?? { id: "" };
  return requirePlan(id);
});
