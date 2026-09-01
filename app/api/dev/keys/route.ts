import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api/crypto";
import { audit } from "@/lib/api/audit";

export const dynamic = "force-dynamic";

const DEFAULT_SCOPES = ["files.read", "files.write"];

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
  const body = (await req.json()) as Body;
  const scopes = body.scopes?.length ? body.scopes : DEFAULT_SCOPES;
  const admin = createAdminClient();

  // Optional plan-level key limit check.
  const { count } = await admin
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= 10) throw new ApiError("KEY_LIMIT_REACHED", 409, "Key limit reached. Revoke an unused key first.");

  const { raw, prefix, hash } = generateApiKey();
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      user_id: user.id,
      api_plan_id: "api_pro",
      key_prefix: prefix,
      hashed_key: hash,
      label: body.label?.trim() || "Untitled key",
      scopes,
      status: "active",
    })
    .select("id, api_plan_id, key_prefix, label, scopes, status, created_at")
    .single();
  if (error) throw new ApiError("CONFLICT", 409, error.message);

  await audit({ actorId: user.id, actorType: "user", action: "api_key.create", targetType: "api_key", targetId: String(data.id), metadata: { label: data.label, scopes } });

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
