import "server-only";
import { handler } from "@/lib/api/auth";
import { listActivePlans } from "@/lib/plans/catalog";

export const dynamic = "force-dynamic";

/**
 * The plan catalogue, as the pricing page and the app see it.
 *
 * This used to be a hardcoded array in this file — one of five copies that had to
 * be kept in step by hand. It now reads the `plans` table, which is what the admin
 * panel writes.
 *
 * Only active plans: a plan an admin has retired should stop being offered, but
 * accounts already on it keep what they have until they change.
 */
export const GET = handler(async () => listActivePlans());
