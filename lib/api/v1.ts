// The public /v1 API: what every endpoint does before and after the handler.
//
// A developer's key is a different kind of caller from a signed-in person: it has no
// session, no cookies, no origin, and it belongs to exactly one account. So the checks
// are different too — the key, then the scope it was granted, then the plan's limits —
// and they live here rather than in each route, because "the one route that forgot" is
// how a public API leaks.
//
// Ownership is never taken from the request. The key resolves to an account, and every
// operation is scoped to that account by lib/services/fileOps.

import "server-only";
import { ApiError } from "./auth";
import { authenticateApiKey, requireScope, enforceApiRequest, recordApiRequest, type DeveloperIdentity } from "./developer";
import { handlePreflight, withCors } from "./cors";

export interface DevRouteContext<P = unknown> {
  identity: DeveloperIdentity;
  params: P;
}

/** The scopes a key can be granted. A key may not name one that is not here. */
export const API_SCOPES = ["files.read", "files.write", "shares.write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Wraps a /v1 handler.
 *
 * Errors are answered the way the app's own handler answers them: a message somebody
 * wrote for the caller reaches them, and anything the runtime produced does not —
 * those name tables, columns and internal paths.
 */
export function devRoute<P, T>(
  opts: { scope: ApiScope },
  fn: (req: Request, ctx: DevRouteContext<P>) => Promise<T>,
): (req: Request, routeCtx?: { params: Promise<P> }) => Promise<Response> {
  return async (req, routeCtx) => {
    const preflight = handlePreflight(req);
    if (preflight) return withCors(req, preflight);

    const started = Date.now();
    // Identified outside the try so a refusal can still be attributed to the key that
    // caused it — a developer debugging 403s should see them in their own usage.
    let identity: DeveloperIdentity | null = null;
    let status = 200;

    try {
      const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      const key = bearer || (req.headers.get("x-api-key") ?? "").trim();
      if (!key) {
        throw new ApiError("UNAUTHORIZED", 401, "Send your API key as a Bearer token in the Authorization header.");
      }

      identity = await authenticateApiKey(key);
      requireScope(identity, opts.scope);
      await enforceApiRequest(identity);

      const params = ((await routeCtx?.params) ?? {}) as P;
      const data = await fn(req, { identity, params });
      return withCors(req, json({ ok: true, data }, 200));
    } catch (e) {
      const err = e as ApiError;
      const deliberate = e instanceof ApiError;
      status = deliberate ? err.status : 500;
      const code = deliberate ? err.code : "INTERNAL_ERROR";
      const message = deliberate ? err.message : "Internal server error.";
      if (!deliberate) console.error("[v1]", (e as Error).message);
      return withCors(req, json({ ok: false, error: { code, message } }, status));
    } finally {
      if (identity) {
        recordApiRequest(identity, {
          endpoint: new URL(req.url).pathname,
          method: req.method,
          status,
          ms: Date.now() - started,
        });
      }
    }
  };
}

/** Preflight for a /v1 route. Browsers ask before sending an Authorization header. */
export function devOptions(): (req: Request) => Promise<Response> {
  return async (req) => withCors(req, handlePreflight(req) ?? new Response(null, { status: 204 }));
}

/** Pagination shared by the listing endpoints. */
export function pageParams(url: URL): { limit: number; offset: number } {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 25)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
  return { limit, offset };
}

/**
 * What a file looks like to a developer.
 *
 * Deliberately not the app's own shape: object_key is ours, not theirs — it names a
 * place in storage and would invite building URLs by hand — and the flags the file
 * manager draws itself with are noise in an API response.
 */
export function publicFile(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.original_filename),
    folderId: row.folder_id ? String(row.folder_id) : null,
    mimeType: row.mime_type ? String(row.mime_type) : null,
    category: String(row.category ?? "other"),
    sizeBytes: Number(row.size_bytes ?? 0),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    hasThumbnail: Boolean(row.thumbnail_url),
    status: String(row.status ?? "pending"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function publicFolder(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    parentId: row.parent_id ? String(row.parent_id) : null,
    path: String(row.path ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
