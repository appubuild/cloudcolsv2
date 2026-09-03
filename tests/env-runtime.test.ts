/**
 * Configuration must be read when it is used, not when the module loads.
 *
 * On Cloudflare Workers the runtime bindings are handed to the Worker per request
 * and copied into process.env at the start of each one — after modules have been
 * evaluated. A config object built at module scope therefore captures an empty
 * environment and keeps it forever, and a deployment with every variable set
 * correctly reports that nothing is configured.
 *
 * These tests set the variables *after* importing, which is the ordering that
 * production has and local development does not.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { env } from "@/lib/config/env";

const KEYS = [
  "B2_ENDPOINT",
  "B2_BUCKET",
  "B2_ACCESS_KEY_ID",
  "B2_SECRET_ACCESS_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "DATA_LAYER",
] as const;

const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});

afterAll(() => {
  for (const k of KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

describe("runtime configuration", () => {
  it("reads values set after the module was imported", () => {
    expect(env.b2.endpoint, "nothing set yet").toBe("");

    process.env.B2_ENDPOINT = "s3.example.com";
    process.env.B2_BUCKET = "a-bucket";
    process.env.B2_ACCESS_KEY_ID = "key-id";
    process.env.B2_SECRET_ACCESS_KEY = "secret";

    expect(env.b2.endpoint).toBe("s3.example.com");
    expect(env.b2.bucket).toBe("a-bucket");
    expect(env.b2.accessKeyId).toBe("key-id");
    expect(env.b2.secretAccessKey).toBe("secret");
  });

  it("sees a later change rather than the first value it saw", () => {
    process.env.B2_BUCKET = "first";
    expect(env.b2.bucket).toBe("first");
    process.env.B2_BUCKET = "second";
    expect(env.b2.bucket).toBe("second");
  });

  it("accepts SUPABASE_URL when only the non-public name is set", () => {
    // The browser can only read the NEXT_PUBLIC_ name, but the server should not
    // refuse to work because a deployment used the plain one.
    process.env.SUPABASE_URL = "https://project.supabase.co";
    expect(env.supabaseUrl).toBe("https://project.supabase.co");
  });

  it("falls back to mock only when no data layer is configured", () => {
    expect(env.dataLayer).toBe("mock");
    process.env.DATA_LAYER = "api";
    expect(env.dataLayer).toBe("api");
  });

  it("sees a NEXT_PUBLIC_ value that was only set at runtime", () => {
    // Next freezes every process.env.NEXT_PUBLIC_X reference at build time, so a
    // deployment that adds one as a runtime variable would otherwise be ignored —
    // silently, because the expression that would read it is gone. The dynamic
    // lookup is what makes this reachable on the server.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://runtime.supabase.co";
    expect(env.supabaseUrl).toBe("https://runtime.supabase.co");
  });

  it("treats an empty string as unset", () => {
    // Cloudflare hands through a variable that was added with a blank value, and
    // "" must not read as configured.
    process.env.B2_ENDPOINT = "";
    expect(env.b2.endpoint).toBe("");
    expect(env.b2.region, "region still falls back to its default").toBe("us-west-000");
  });
});
