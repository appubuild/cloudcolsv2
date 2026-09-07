/**
 * The plan catalogue's pure parts.
 *
 * Plans are rows now, so "what does Pro cost" is a database question and not
 * something a unit test can answer. What a test can still hold onto is the logic
 * between the row and the decision — the mapping, and the lookup that a caller
 * uses to turn a request's plan id into an entitlement. Both have been wrong
 * before, and both fail quietly.
 */
import { describe, it, expect } from "vitest";
import { mapPlan, pickPlan, type PlanRow } from "@/lib/plans/catalog";

function row(over: Partial<PlanRow> = {}): PlanRow {
  return {
    id: "plan_pro",
    name: "Pro",
    tagline: "For creators & pros",
    storage_quota_bytes: 214748364800,
    max_file_size_bytes: 3221225472,
    price_cents: 899,
    billing_interval: "monthly",
    features: ["200 GB storage", "No ads"],
    shows_ads: false,
    api_included: true,
    is_active: true,
    is_default: false,
    sort_order: 2,
    ...over,
  };
}

describe("plan mapping", () => {
  it("maps a row to the shape the clients consume", () => {
    const plan = mapPlan(row());
    expect(plan).toMatchObject({
      id: "plan_pro",
      name: "Pro",
      storageQuotaBytes: 214748364800,
      maxFileSizeBytes: 3221225472,
      priceCents: 899,
      billingInterval: "monthly",
      showsAds: false,
      apiIncluded: true,
      isActive: true,
      sortOrder: 2,
    });
    expect(plan.features).toEqual(["200 GB storage", "No ads"]);
  });

  it("reads a bigint that arrived as a string", () => {
    // PostgREST sends bigint as a JSON string once it is large enough. Left as a
    // string, every quota comparison becomes a string comparison, and "5" > "1024".
    const plan = mapPlan(row({ storage_quota_bytes: "1099511627776", max_file_size_bytes: "5368709120" }));
    expect(plan.storageQuotaBytes).toBe(1099511627776);
    expect(plan.maxFileSizeBytes).toBe(5368709120);
    expect(typeof plan.storageQuotaBytes).toBe("number");
  });

  it("survives a features column that is not an array", () => {
    // features is jsonb; nothing at the database level stops someone writing an
    // object into it, and the pricing page maps over the result.
    expect(mapPlan(row({ features: null })).features).toEqual([]);
    expect(mapPlan(row({ features: { a: 1 } })).features).toEqual([]);
  });

  it("treats a free plan's missing interval as free, not as broken", () => {
    const plan = mapPlan(row({ id: "plan_free", price_cents: 0, billing_interval: null }));
    expect(plan.priceCents).toBe(0);
    expect(plan.billingInterval).toBeNull();
  });
});

describe("plan lookup", () => {
  const plans = [
    mapPlan(row({ id: "plan_free", price_cents: 0, billing_interval: null, is_default: true })),
    mapPlan(row({ id: "plan_pro" })),
  ];

  it("finds a plan by id", () => {
    expect(pickPlan(plans, "plan_pro")?.id).toBe("plan_pro");
  });

  it("returns null for an id it does not know", () => {
    expect(pickPlan(plans, "plan_free_but_huge")).toBeNull();
    expect(pickPlan(plans, "")).toBeNull();
  });

  it("cannot be talked into returning a prototype property", () => {
    // The keyed-object lookup this replaced resolved "__proto__" to Object's
    // prototype, which has no quota — and undefined then went into the account's
    // storage limit. A list scan can only return a row that was really there.
    expect(pickPlan(plans, "__proto__")).toBeNull();
    expect(pickPlan(plans, "toString")).toBeNull();
    expect(pickPlan(plans, "constructor")).toBeNull();
  });
});
