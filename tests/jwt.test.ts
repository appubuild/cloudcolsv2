import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { verifySupabaseJwt, resetJwksCache } from "../lib/api/jwt";

/**
 * Real ES256 keys, real signatures.
 *
 * A test that mocked crypto.subtle.verify would pass whatever the verifier did with the
 * result. These sign actual tokens with a generated P-256 key, publish the public half
 * as a JWKS the verifier fetches, and then tamper with them.
 */

const SUPABASE_URL = "https://example-project.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;

let signingKey: CryptoKey;
let publicJwk: JsonWebKey;
let otherKey: CryptoKey;
let jwksFetches = 0;

const b64url = (bytes: Uint8Array | ArrayBuffer) =>
  Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString("base64url");

async function sign(
  claims: Record<string, unknown>,
  opts: { kid?: string; key?: CryptoKey; alg?: string } = {},
): Promise<string> {
  const header = { alg: opts.alg ?? "ES256", kid: opts.kid ?? "key-1", typ: "JWT" };
  const h = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const p = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    opts.key ?? signingKey,
    new TextEncoder().encode(`${h}.${p}`),
  );
  return `${h}.${p}.${b64url(sig)}`;
}

function validClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    sub: "user-123",
    aud: "authenticated",
    role: "authenticated",
    email: "a@example.com",
    exp: now + 3600,
    iat: now,
    session_id: "sess-1",
    ...overrides,
  };
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  signingKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  otherKey = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])).privateKey;
});

beforeEach(() => {
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = "anon";
  resetJwksCache();
  jwksFetches = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).endsWith("/auth/v1/.well-known/jwks.json")) {
      jwksFetches += 1;
      return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "key-1", alg: "ES256" }] }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifySupabaseJwt", () => {
  it("accepts a genuine, current token for this project", async () => {
    const r = await verifySupabaseJwt(await sign(validClaims()));
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.claims.sub).toBe("user-123");
      expect(r.claims.email).toBe("a@example.com");
      expect(r.claims.sessionId).toBe("sess-1");
    }
  });

  it("refuses a token whose payload was edited after signing", async () => {
    const token = await sign(validClaims());
    const [h, , s] = token.split(".");
    const forged = b64url(new TextEncoder().encode(JSON.stringify(validClaims({ sub: "someone-else" }))));
    expect((await verifySupabaseJwt(`${h}.${forged}.${s}`)).status).toBe("invalid");
  });

  it("refuses a token signed by a different key under the same kid", async () => {
    expect((await verifySupabaseJwt(await sign(validClaims(), { key: otherKey }))).status).toBe("invalid");
  });

  it("refuses an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const r = await verifySupabaseJwt(await sign(validClaims({ exp: past })));
    expect(r).toEqual({ status: "invalid", reason: "expired" });
  });

  it("allows a few seconds of clock disagreement", async () => {
    const justNow = Math.floor(Date.now() / 1000) - 5;
    expect((await verifySupabaseJwt(await sign(validClaims({ exp: justNow })))).status).toBe("ok");
  });

  it("refuses a genuine token from another project", async () => {
    const r = await verifySupabaseJwt(await sign(validClaims({ iss: "https://other.supabase.co/auth/v1" })));
    expect(r).toEqual({ status: "invalid", reason: "wrong issuer" });
  });

  it("refuses a token not meant for signed-in users", async () => {
    expect((await verifySupabaseJwt(await sign(validClaims({ aud: "something-else" })))).status).toBe("invalid");
    // An anon key is a JWT from the same issuer; it must not pass as a session.
    expect((await verifySupabaseJwt(await sign(validClaims({ role: "anon" })))).status).toBe("invalid");
  });

  it("does not decide on an algorithm it cannot check, and does not refuse either", async () => {
    // HS256 needs a shared secret this code does not hold: the caller should ask Auth.
    const r = await verifySupabaseJwt(await sign(validClaims(), { alg: "HS256" }));
    expect(r.status).toBe("unavailable");
  });

  it("refetches the key set once when a token names a key it has not seen", async () => {
    await verifySupabaseJwt(await sign(validClaims()));
    expect(jwksFetches).toBe(1);
    const r = await verifySupabaseJwt(await sign(validClaims(), { kid: "rotated-key" }));
    // Tried again, found nothing, and said so rather than guessing.
    expect(jwksFetches).toBe(2);
    expect(r.status).toBe("unavailable");
  });

  it("caches the key set between requests", async () => {
    for (let i = 0; i < 5; i += 1) await verifySupabaseJwt(await sign(validClaims()));
    expect(jwksFetches).toBe(1);
  });

  it("says 'unavailable', not 'invalid', when the key set cannot be fetched", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    resetJwksCache();
    expect((await verifySupabaseJwt(await sign(validClaims()))).status).toBe("unavailable");
  });

  it("refuses things that are not tokens at all", async () => {
    for (const bad of ["", "abc", "a.b", "a.b.c.d", "!!!.???.***"]) {
      expect((await verifySupabaseJwt(bad)).status).not.toBe("ok");
    }
  });
});
