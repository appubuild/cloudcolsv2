// Two-factor authentication with an authenticator app (TOTP).
//
// Supabase Auth does the cryptography and holds the factors. A session proven with a
// second factor carries aal=aal2 in its token; one proven with a password alone carries
// aal1. requireUser refuses aal1 sessions for accounts with 2FA on (the flag lives in
// user_storage.mfa_enabled, migration 0027), except on the few routes that finish or
// recover a sign-in.
//
// The factor endpoints are called with the user's own access token, as the Auth API
// requires; listing and deleting factors uses the admin API, because recovering a
// locked-out account must work without the second factor it has lost.

import "server-only";
import { serverEnv } from "@/lib/config/server-env";
import { createAdminClient } from "@/lib/supabase/server";
import { ApiError } from "./auth";
import { hashSecret } from "./crypto";
import { tokensFrom, type SessionTokens } from "./session";

const ISSUER = "CloudCols";
const FRIENDLY_NAME = "Authenticator app";
const RECOVERY_CODE_COUNT = 10;
/** No 0/o or 1/l/i: recovery codes get read off paper and typed by hand. */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

async function authApi<T>(path: string, accessToken: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(`${serverEnv.supabaseUrl}/auth/v1${path}`, {
    method,
    headers: {
      apikey: serverEnv.supabaseAnonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = String(json.msg ?? json.message ?? json.error_description ?? `HTTP ${res.status}`);
    throw Object.assign(new Error(message), { status: res.status });
  }
  return json as T;
}

export interface TotpFactor {
  id: string;
  status: string;
}

/** The account's TOTP factors, verified or not. */
export async function listTotpFactors(userId: string): Promise<TotpFactor[]> {
  const { data, error } = await createAdminClient().auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  return (data?.factors ?? [])
    .filter((f) => f.factor_type === "totp")
    .map((f) => ({ id: String(f.id), status: String(f.status) }));
}

export async function verifiedFactor(userId: string): Promise<TotpFactor | null> {
  return (await listTotpFactors(userId)).find((f) => f.status === "verified") ?? null;
}

async function deleteFactor(userId: string, factorId: string): Promise<void> {
  const { error } = await createAdminClient().auth.admin.mfa.deleteFactor({ userId, id: factorId });
  if (error) throw error;
}

/** Removes every TOTP factor; used before a fresh setup and when 2FA is turned off. */
export async function removeTotpFactors(userId: string): Promise<void> {
  for (const f of await listTotpFactors(userId)) await deleteFactor(userId, f.id);
}

/** Starts a setup: a new, unverified factor, and the secret to show as a QR code. */
export async function enrollTotp(accessToken: string): Promise<{ factorId: string; qrCode: string; secret: string; uri: string }> {
  const r = await authApi<{ id: string; totp: { qr_code: string; secret: string; uri: string } }>("/factors", accessToken, {
    factor_type: "totp",
    friendly_name: FRIENDLY_NAME,
    issuer: ISSUER,
  });
  // Supabase hands back the QR code as a raw SVG document, not a data: URL. Wrapped
  // here so the page shows it in an <img>, where an SVG cannot run script — rather than
  // inserting someone else's markup into the page to make it display.
  const raw = r.totp.qr_code;
  const qrCode = raw.startsWith("data:") ? raw : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`;
  return { factorId: r.id, qrCode, secret: r.totp.secret, uri: r.totp.uri };
}

/**
 * Checks a 6-digit code and returns the stronger (aal2) session Supabase issues for it.
 *
 * A fresh challenge each time: a challenge is single-use and short-lived, so holding
 * one between a page load and a typed code would only add a way to fail.
 */
export async function verifyTotp(accessToken: string, factorId: string, code: unknown): Promise<SessionTokens> {
  const clean = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) {
    throw new ApiError("INVALID_CODE", 400, "Enter the 6-digit code from your authenticator app.");
  }
  const challenge = await authApi<{ id: string }>(`/factors/${factorId}/challenge`, accessToken, {});
  try {
    const session = await authApi<{ access_token: string; refresh_token: string; expires_in?: number }>(
      `/factors/${factorId}/verify`,
      accessToken,
      { challenge_id: challenge.id, code: clean },
    );
    return tokensFrom(session);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    if (status >= 400 && status < 500) {
      throw new ApiError(
        "INVALID_CODE",
        400,
        "That code is not right. Use the newest code in the app, and check that your phone sets its clock automatically.",
      );
    }
    throw e;
  }
}

// --- the account flag ------------------------------------------------------

export async function setMfaEnabled(userId: string, enabled: boolean): Promise<void> {
  const { error } = await createAdminClient().from("user_storage").update({ mfa_enabled: enabled }).eq("user_id", userId);
  if (error) throw error;
}

/** Everything that makes up 2FA, gone: factors, recovery codes, and the flag. */
export async function turnOffMfa(userId: string): Promise<void> {
  await removeTotpFactors(userId);
  await createAdminClient().from("mfa_recovery_codes").delete().eq("user_id", userId);
  await setMfaEnabled(userId, false);
}

// --- recovery codes --------------------------------------------------------

function normalize(code: string): string {
  return code.toLowerCase().replace(/[^0-9a-z]/g, "");
}

function hashCode(code: string): string {
  return hashSecret(`mfa-recovery:${normalize(code)}`);
}

/** One code, "xxxxx-xxxxx": about 50 bits, from rejection-sampled random bytes. */
function randomCode(): string {
  let out = "";
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < 10) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Issues a fresh set, invalidating any previous one. The plaintext is returned once. */
export async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomCode);
  const admin = createAdminClient();
  const { error: delError } = await admin.from("mfa_recovery_codes").delete().eq("user_id", userId);
  if (delError) throw delError;
  const { error } = await admin
    .from("mfa_recovery_codes")
    .insert(codes.map((c) => ({ user_id: userId, code_hash: hashCode(c) })));
  if (error) throw error;
  return codes;
}

/**
 * Spends one recovery code. A single UPDATE that only matches an unused code, so two
 * requests racing with the same code cannot both succeed.
 */
export async function consumeRecoveryCode(userId: string, code: unknown): Promise<boolean> {
  const value = String(code ?? "");
  if (normalize(value).length !== 10) return false;
  const { data, error } = await createAdminClient()
    .from("mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("code_hash", hashCode(value))
    .is("used_at", null)
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}

export async function countRecoveryCodes(userId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from("mfa_recovery_codes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("used_at", null);
  return count ?? 0;
}
