"use client";

/**
 * The public configuration the browser needs, handed down by the server.
 *
 * Sign-in talks to Supabase directly from the browser, so the browser needs the
 * project URL and the publishable key. The usual way to give it those is
 * NEXT_PUBLIC_* variables, which Next inlines at build time — and that is exactly
 * the mechanism that kept failing here: a value present in the Worker's runtime
 * bindings is invisible to a bundle that was built without it, and nothing says
 * so. The result was a deployment whose server was correctly configured while the
 * browser could not sign anyone in.
 *
 * The server reads these from the Worker's bindings and passes them through the
 * page, so there is one place to configure and it is the place that works. Both
 * values are public by design; the service-role key is not here and never will be.
 *
 * The inlined values remain a fallback, so `next dev` with a .env.local behaves as
 * it always did.
 */

export interface PublicConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

let injected: PublicConfig | null = null;

/** Called during render by the bridge in the root layout, before anything reads it. */
export function setPublicConfig(config: PublicConfig): void {
  if (config.supabaseUrl || config.supabaseAnonKey) injected = config;
}

export function publicConfig(): PublicConfig {
  if (injected) return injected;
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
}
