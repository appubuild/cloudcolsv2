// Type-safe config read from environment variables on the SERVER side.
// Client-safe values are exposed via NEXT_PUBLIC_* and read where needed.

export const env = {
  // Data layer selection. The client (repository facade) can only read
  // NEXT_PUBLIC_* vars, so the client-facing switch MUST be NEXT_PUBLIC_DATA_LAYER
  // (inlined by Next at build). DATA_LAYER is kept as a server-side alias.
  dataLayer: process.env.NEXT_PUBLIC_DATA_LAYER ?? process.env.DATA_LAYER ?? "mock", // "mock" | "api"

  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", // SERVER ONLY

  b2: {
    endpoint: process.env.B2_ENDPOINT ?? "",
    region: process.env.B2_REGION ?? "us-west-000",
    bucket: process.env.B2_BUCKET ?? "",
    accessKeyId: process.env.B2_ACCESS_KEY_ID ?? "", // SERVER ONLY
    secretAccessKey: process.env.B2_SECRET_ACCESS_KEY ?? "", // SERVER ONLY
    publicDomain: process.env.B2_PUBLIC_DOMAIN ?? "", // CDN/custom domain for delivery
  },

  cloudflare: {
    workerUrl: process.env.CLOUDFLARE_WORKER_URL ?? "",
    cdnDomain: process.env.CDN_DOMAIN ?? "", // signed-delivery worker URL
    cdnTicketSecret: process.env.CDN_TICKET_SECRET ?? "", // SERVER ONLY
  },

  email: {
    provider: process.env.EMAIL_PROVIDER ?? "console", // console | resend | smtp | custom
    from: process.env.EMAIL_FROM ?? "",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  },

  jobs: {
    token: process.env.JOBS_TOKEN ?? "", // scheduler auth (SERVER ONLY)
  },

  API_BASE_URL_INTERNAL: "/api", // same-origin route handlers
} as const;

/** Whether the app should use the real API layer (server) vs the mock repos. */
export const isApiLayer = env.dataLayer === "api";
