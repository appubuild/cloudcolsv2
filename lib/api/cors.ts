// CORS handling for the public developer API.

import "server-only";

const SAFE_DEFAULT = "https://app.yourdomain.com";

function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  // Allowlist: public browser origins. The web app runs same-origin so it never
  // needs CORS; this is for the developer /v1 API consumed by third parties.
  const configured = (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = configured.length ? configured : [SAFE_DEFAULT, "http://localhost:3000"];
  return origin && allowed.includes(origin) ? origin : null;
}

/** Return preflight (OPTIONS) response for an API route, or null if not preflighted. */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  const origin = allowedOrigin(req);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, x-api-key",
    "Access-Control-Max-Age": "86400",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(null, { status: 204, headers });
}

/** Attach CORS headers to a Response (call from a public API handler). */
export function withCors(req: Request, res: Response): Response {
  const origin = allowedOrigin(req);
  if (origin) res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Expose-Headers", "x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset");
  if (req.headers.get("access-control-request-headers")) {
    res.headers.set("Access-Control-Allow-Headers", req.headers.get("access-control-request-headers") ?? "");
  }
  return res;
}
