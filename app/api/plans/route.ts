import "server-only";
import { handler } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

// Plans are configuration. This returns a static set matching the product's
// plan catalog. In production plans live in a Postgres table configurable by
// the admin panel.
const PLANS = [
  { id: "plan_free", name: "Free", tagline: "For getting started", storageQuotaBytes: 5 * 1024 * 1024 * 1024, priceCents: 0, billingInterval: null, features: ["5 GB storage", "Basic file manager", "Ads shown", "Sharing links"], showsAds: true, apiIncluded: false, maxFileSizeBytes: 1 * 1024 * 1024 * 1024, isActive: true, sortOrder: 0 },
  { id: "plan_plus", name: "Plus", tagline: "For everyday use", storageQuotaBytes: 100 * 1024 * 1024 * 1024, priceCents: 499, billingInterval: "monthly", features: ["100 GB storage", "No ads", "2 GB max file size", "Advanced sharing"], showsAds: false, apiIncluded: false, maxFileSizeBytes: 2 * 1024 * 1024 * 1024, isActive: true, sortOrder: 1 },
  { id: "plan_pro", name: "Pro", tagline: "For creators & pros", storageQuotaBytes: 200 * 1024 * 1024 * 1024, priceCents: 899, billingInterval: "monthly", features: ["200 GB storage", "No ads", "3 GB max file size", "Priority support"], showsAds: false, apiIncluded: true, maxFileSizeBytes: 3 * 1024 * 1024 * 1024, isActive: true, sortOrder: 2 },
  { id: "plan_business", name: "Business", tagline: "For teams & power users", storageQuotaBytes: 1024 * 1024 * 1024 * 1024, priceCents: 1999, billingInterval: "monthly", features: ["1 TB storage", "No ads", "5 GB max file size", "API access"], showsAds: false, apiIncluded: true, maxFileSizeBytes: 5 * 1024 * 1024 * 1024, isActive: true, sortOrder: 3 },
];

export const GET = handler(async () => PLANS);
