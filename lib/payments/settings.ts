import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { sealSecret, openSecret } from "@/lib/api/secretBox";

/**
 * Reading and writing a provider's configuration.
 *
 * The split between `public` and `secret` is the whole point of this module. The
 * public half — a publishable key, price ids — is designed to be seen and is
 * returned freely. The secret half is encrypted at rest and is only ever
 * decrypted inside this process, on its way to the provider's API.
 *
 * There is deliberately no function that returns the secret half to a caller
 * outside the payment adapters. An admin who wants to check a key replaces it;
 * the panel shows whether one is set, never what it is.
 */

export type ProviderId = "stripe" | "crypto";

export interface PublicConfig {
  publishableKey?: string;
  priceIds?: Record<string, string>;
  [key: string]: unknown;
}

export interface SecretConfig {
  secretKey?: string;
  webhookSecret?: string;
  [key: string]: unknown;
}

export interface ProviderSettings {
  provider: ProviderId;
  isEnabled: boolean;
  testMode: boolean;
  publicConfig: PublicConfig;
  /** Whether a secret is stored — never the secret itself. */
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  updatedAt: string | null;
}

interface Row {
  provider: string;
  is_enabled: boolean;
  test_mode: boolean;
  public_config: PublicConfig | null;
  secret_ciphertext: string | null;
  secret_iv: string | null;
  updated_at: string | null;
}

async function row(provider: ProviderId): Promise<Row | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("payment_settings").select("*").eq("provider", provider).maybeSingle();
  return (data as Row | null) ?? null;
}

/** What the admin panel may see: everything except the secrets themselves. */
export async function readSettings(provider: ProviderId): Promise<ProviderSettings> {
  const r = await row(provider);
  let hasSecretKey = false;
  let hasWebhookSecret = false;

  if (r?.secret_ciphertext && r.secret_iv) {
    try {
      const secret = JSON.parse(await openSecret(r.secret_ciphertext, r.secret_iv)) as SecretConfig;
      hasSecretKey = Boolean(secret.secretKey);
      hasWebhookSecret = Boolean(secret.webhookSecret);
    } catch {
      // A stored value that will not decrypt means the master key changed. Report
      // it as absent rather than throwing: the panel should still load so someone
      // can set it again.
    }
  }

  return {
    provider,
    isEnabled: Boolean(r?.is_enabled),
    testMode: r?.test_mode ?? true,
    publicConfig: r?.public_config ?? {},
    hasSecretKey,
    hasWebhookSecret,
    updatedAt: r?.updated_at ?? null,
  };
}

/** The decrypted secrets, for the adapters only. Never returned by an endpoint. */
export async function readSecrets(provider: ProviderId): Promise<SecretConfig> {
  const r = await row(provider);
  if (!r?.secret_ciphertext || !r.secret_iv) return {};
  try {
    return JSON.parse(await openSecret(r.secret_ciphertext, r.secret_iv)) as SecretConfig;
  } catch {
    return {};
  }
}

/**
 * Saves settings.
 *
 * A secret that is not supplied is left as it was. The panel cannot show an
 * existing key, so it sends an empty field for "unchanged" — and treating that as
 * "clear it" would wipe a working configuration every time an admin toggled test
 * mode.
 */
export async function writeSettings(
  provider: ProviderId,
  patch: {
    isEnabled?: boolean;
    testMode?: boolean;
    publicConfig?: PublicConfig;
    secretKey?: string;
    webhookSecret?: string;
  },
  actorId: string | null,
): Promise<ProviderSettings> {
  const admin = createAdminClient();
  const existing = await readSecrets(provider);

  const secrets: SecretConfig = { ...existing };
  if (patch.secretKey) secrets.secretKey = patch.secretKey.trim();
  if (patch.webhookSecret) secrets.webhookSecret = patch.webhookSecret.trim();

  const sealed = Object.keys(secrets).length ? await sealSecret(JSON.stringify(secrets)) : null;

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  };
  if (patch.isEnabled !== undefined) updates.is_enabled = patch.isEnabled;
  if (patch.testMode !== undefined) updates.test_mode = patch.testMode;
  if (patch.publicConfig !== undefined) updates.public_config = patch.publicConfig;
  if (sealed) {
    updates.secret_ciphertext = sealed.ciphertext;
    updates.secret_iv = sealed.iv;
  }

  const { error } = await admin.from("payment_settings").update(updates).eq("provider", provider);
  if (error) throw error;

  return readSettings(provider);
}
