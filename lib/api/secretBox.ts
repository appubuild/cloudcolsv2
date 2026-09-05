import "server-only";
import { serverConfig } from "@/lib/config/server-env";

/**
 * Encrypts the settings an admin types in, so the database never holds a payment
 * credential in readable form.
 *
 * The alternative — Worker secrets — cannot be changed from the admin panel, and
 * rotating a Stripe key would mean a deploy. Storing it in Postgres is only
 * acceptable if a database dump is useless without a second thing, so the key
 * that decrypts these values is a Worker secret and never reaches Postgres.
 *
 * AES-256-GCM because Web Crypto has it and Workers has Web Crypto; it also
 * authenticates, so a tampered ciphertext fails to decrypt rather than returning
 * something plausible.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function masterKey(): Promise<CryptoKey> {
  const raw = serverConfig("SETTINGS_MASTER_KEY");
  if (!raw) {
    // A missing key is a deployment mistake, not a state to carry on in: without
    // it nothing can be read back, and encrypting with a default would be worse
    // than not encrypting at all.
    throw new Error("SETTINGS_MASTER_KEY is not set; payment settings cannot be read or written.");
  }
  // The key is a passphrase rather than 32 raw bytes, so it is hashed to length.
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealSecret(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await masterKey();
  // A fresh IV per write. Reusing one with GCM leaks the plaintext difference
  // between two values encrypted under the same key.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { ciphertext: base64(new Uint8Array(sealed)), iv: base64(iv) };
}

export async function openSecret(ciphertext: string, iv: string): Promise<string> {
  const key = await masterKey();
  const opened = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) as BufferSource },
    key,
    fromBase64(ciphertext) as BufferSource,
  );
  return dec.decode(opened);
}
