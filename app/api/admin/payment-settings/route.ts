import "server-only";
import { handler, ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { audit } from "@/lib/api/audit";
import { readSettings, writeSettings, type ProviderId } from "@/lib/payments/settings";

export const dynamic = "force-dynamic";

const PROVIDERS: ProviderId[] = ["stripe", "crypto"];

function provider(req: Request): ProviderId {
  const value = new URL(req.url).searchParams.get("provider") ?? "stripe";
  if (!PROVIDERS.includes(value as ProviderId)) {
    throw new ApiError("INVALID_INPUT", 400, "Unknown payment provider.");
  }
  return value as ProviderId;
}

/**
 * What an admin may see of a payment provider's configuration.
 *
 * Never the secret key or the webhook secret — not masked, not partially, not
 * once. The panel is told whether one is stored; to change it you type a new one.
 * A settings screen that can display a secret is a settings screen that leaks it
 * to anyone who reaches the endpoint, and admin sessions are the thing an attacker
 * works hardest to get.
 */
export const GET = handler(async (req: Request) => {
  await requireAdmin(req, "super_admin");
  return readSettings(provider(req));
});

interface Body {
  isEnabled?: boolean;
  testMode?: boolean;
  publishableKey?: string;
  priceIds?: Record<string, string>;
  /** Blank means "leave the stored one alone" — the panel cannot show it to echo back. */
  secretKey?: string;
  webhookSecret?: string;
}

export const PUT = handler(async (req: Request) => {
  const admin = await requireAdmin(req, "super_admin");
  const id = provider(req);
  const body = (await req.json()) as Body;

  const current = await readSettings(id);
  const publicConfig = {
    ...current.publicConfig,
    ...(body.publishableKey !== undefined ? { publishableKey: body.publishableKey.trim() } : {}),
    ...(body.priceIds !== undefined ? { priceIds: body.priceIds } : {}),
  };

  // Refusing to enable a provider that cannot verify a webhook. Without the
  // signing secret nothing can be verified, so money could be taken for a plan
  // that would never activate.
  const willHaveWebhookSecret = current.hasWebhookSecret || Boolean(body.webhookSecret);
  const willHaveSecretKey = current.hasSecretKey || Boolean(body.secretKey);
  if (body.isEnabled && id === "stripe" && (!willHaveSecretKey || !willHaveWebhookSecret)) {
    throw new ApiError(
      "INVALID_INPUT",
      400,
      "Stripe needs both a secret key and a webhook signing secret before it can be enabled.",
    );
  }

  const saved = await writeSettings(
    id,
    {
      isEnabled: body.isEnabled,
      testMode: body.testMode,
      publicConfig,
      secretKey: body.secretKey,
      webhookSecret: body.webhookSecret,
    },
    // The auth account, not the admins row: updated_by references auth.users.
    admin.userId,
  );

  // Which fields changed, never their values.
  await audit({
    actorId: admin.id,
    actorType: "admin",
    action: "payment_settings.updated",
    targetType: "payment_provider",
    targetId: id,
    metadata: {
      isEnabled: saved.isEnabled,
      testMode: saved.testMode,
      secretKeyChanged: Boolean(body.secretKey),
      webhookSecretChanged: Boolean(body.webhookSecret),
    },
  });

  return saved;
});
