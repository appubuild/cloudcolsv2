import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api/crypto";
import { audit } from "@/lib/api/audit";
import { API_SCOPES, type ApiScope } from "@/lib/api/v1";
import { accountApiPlan } from "@/lib/api/apiPlan";

export const dynamic = "force-dynamic";

const DEFAULT_SCOPES: ApiScope[] = ["files.read", "files.write"];
const KEY_LIMIT = 10;

// List API keys (never expose the secret / hash — only the prefix).
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_keys")
    .select("id, api_plan_id, key_prefix, label, scopes, status, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: String(r.id),
    userId: user.id,
    apiPlanId: String(r.api_plan_id),
    keyPrefix: String(r.key_prefix),
    hashedKey: "",
    label: String(r.label),
    scopes: (r.scopes as string[]) ?? [],
    status: r.status as "active" | "revoked",
    createdAt: String(r.created_at),
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
  }));
});

// Create a key. The raw secret is returned ONCE — only the hash is stored.
interface Body {
  label?: string;
  scopes?: string[];
}
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as Body;

  /**
   * Scopes are checked against the list the API actually enforces.
   *
   * They used to be stored as sent. A key could carry any string, including one that
   * looked like a permission but matched no check — which reads, to whoever made it,
   * as a restriction that is not there.
   */
  const requested = body.scopes?.length ? body.scopes : DEFAULT_SCOPES;
  const unknown = requested.filter((s) => !API_SCOPES.includes(s as ApiScope));
  if (unknown.length) {
    throw new ApiError("INVALID_INPUT", 400, `Unknown scope: ${unknown.join(", ")}. Available: ${API_SCOPES.join(", ")}`);
  }

  const admin = createAdminClient();
  const { count } = await admin
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= KEY_LIMIT) {
    throw new ApiError("KEY_LIMIT_REACHED", 409, "Key limit reached. Revoke an unused key first.");
  }

  // The account's plan, not a hardcoded one. Every key used to be created on the paid
  // "api_pro" plan whatever the account was entitled to, which handed out its rate and
  // monthly allowance for nothing.
  const apiPlanId = await accountApiPlan(user.id);

  const { raw, prefix, hash } = generateApiKey();
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      user_id: user.id,
      api_plan_id: apiPlanId,
      key_prefix: prefix,
      hashed_key: hash,
      label: body.label?.trim() || "Untitled key",
      scopes: requested,
      status: "active",
    })
    .select("id, api_plan_id, key_prefix, label, scopes, status, created_at")
    .single();
  if (error) throw new ApiError("CONFLICT", 409, error.message);

  await audit({
    actorId: user.id,
    actorType: "user",
    action: "api_key.create",
    targetType: "api_key",
    targetId: String(data.id),
    metadata: { label: data.label, scopes: requested, apiPlanId },
  });

  return {
    key: {
      id: String(data.id),
      userId: user.id,
      apiPlanId: String(data.api_plan_id),
      keyPrefix: String(data.key_prefix),
      hashedKey: "",
      label: String(data.label),
      scopes: (data.scopes as string[]) ?? [],
      status: data.status as "active",
      createdAt: String(data.created_at),
      lastUsedAt: null,
    },
    secret: raw, // shown once
  };
});
