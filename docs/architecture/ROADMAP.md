# CloudCols — Roadmap

Phase-by-phase plan. Phase 1 is complete in this repository. Later phases add the real backend and clients.

## Phase 0 — Architecture ✅
- Repository inspection, plan, architecture doc, roadmap. Done in `docs/`.

## Phase 1 — Project foundation ✅
- Next.js + TS + Tailwind, design tokens, route groups, repository abstraction, Zustand + React Query, error handling.

## Phase 2 — Authentication ✅ (real wiring, UI already done)
- Supabase Auth wiring: sign-up, login, `me`, logout route handlers with server-side token validation.
- Storage-profile provisioning (`user_storage`) + RLS.
- API-backed `ApiAuthRepository`; repository facade flips mock ⇄ api via `DATA_LAYER`.
- **Prod-hardened (Phase 2.1):** rate limiting (sliding-window, per-IP, configurable limits, 429 `RATE_LIMITED`), transactional email abstraction (console/resend/smtp, never throws), email-verification + password-reset endpoints, welcome/verify/reset emails. Server-side secrets never enter the browser bundle.
- **To do in prod:** admin session isolation (separate admin auth) remains.

## Phase 3 — Storage core ✅ (real wiring for upload/download)
- Backblaze B2 integration via S3-compatible SDK: presigned **upload** PUT URLs, **download** GET URLs, HEAD-verify, delete.
- Server-side quota + max-file-size enforcement (`assertCanUpload`), category derivation + object-key generation, folder logic.
- Upsert "collect" endpoints: `/api/files/upload-ticket` → client PUTs directly to B2 → `/api/files/confirm` verifies object via HEAD and syncs quota (Postgres trigger).
- **Prod-hardened (Phase 2.1):** async thumbnail job (`lib/jobs/thumbnail.ts`, deterministic `derivatives/thumbs/` keys), trash-cleanup + inactivity lifecycle jobs, background job framework (`/api/jobs/run`, cron/queued) with audit logging. `lib/services/cdn.ts` builds short-TTL signed tickets.
- **To do:** true multipart/resumable for very large files (pixabay-scale).

## Phase 4 — File manager ✅
- Folders, grid/list, breadcrumbs, search, sort, filter, rename, move, delete→trash, favorites, recent, bulk actions, upload tray.
- API-backed file/folder CRUD endpoints for the swap.
- **Dashboard enhancements:** Recent Access (files + folders, newest first, auto-marked on open/download/preview), Recent Folders, Favorite Folders (star toggle, `folders.is_favorite` + `last_accessed_at`), modern cloud-storage dashboard. Backend: `/api/recent` (GET feed + POST touch), `/api/folders?favorite|recent`, `folders/[id]` favorite toggle, migrations `0005`.

## Phase 5 — Media ✅ (UI) / 🔜 (real)
- Preview overlay for image/video/audio/pdf/other.
- **To do:** real thumbnails (image resize, video first-frame, PDF first-page) via async worker; CDN delivery; range-request streaming.

## Phase 6 — Sharing ✅ (UI) / 🔜 (real)
- Share create/revoke + public share page states.
- **To do:** expiration + password-protected links, access analytics, revocation invalidation.

## Phase 7 — Monetization ✅ (UI) / 🔜 (real)
- Plans, checkout simulation, quota enforcement, ads config.
- **To do:** payment provider adapters, subscription jobs, revenue accounting.

## Phase 8 — Developer API ✅ (UI) / 🔜 (real)
- Developer portal: enablement, keys, docs, usage, webhooks, billing; rate-limit config.
- **Prod-hardened (Phase 2.1):** scoped API keys hashed at rest (`cc_live_` prefix shown once), per-plan sliding-window rate limiting, usage request logging, async HMAC-signed webhook delivery with retries, `/api/dev/*` endpoints (keys, plans, usage, webhooks), `api_plans`/`api_keys`/`webhooks` tables.
- **To do:** public `/v1` REST server + webhook-fire on all mutations (partially wired).

## Phase 9 — Admin ✅ (UI) / 🔜 (real)
- Dashboard, users, storage ops, plans, subscriptions, payments, API, ads, content, security.
- **Prod-hardened (Phase 2.1):** real subscription/plan-change/checkout endpoints (quota updated server-side), `subscriptions`/`payments` tables, `audit_logs` for every destructive/security action, inactivity policy + trash-cleanup jobs, configurable retention.
- **To do:** admin RBAC enforcement, quarantine workflow.

## Phase 10 — Optimization ✅
- React Query `staleTime` tuning (30s queries), debounced search (300ms, no per-keystroke query), pagination on `/api/files`, `no-store` cache on all API responses, CDN `immutable` headers on hashed static assets, DB indexes (`supabase/migrations/0003_indexes.sql`), `next.config`/`vercel.json` cache headers.

## Phase 11 — Security review ✅
- No server secrets in client bundles (only `NEXT_PUBLIC_*` are browser-safe); server-only secrets stay in `server-only` modules. API keys hashed at rest (SHA-256), HMAC-signed webhooks + signed CDN tickets, per-IP sliding-window rate limits (429), server-generated opaque object keys (no path traversal), server-side quota + max-file-size enforcement, CORS allowlist helper for the public `/v1` API, CSP-style security headers + `X-Frame-Options`/`Referrer-Policy`/`Permissions-Policy`.

## Phase 12 — Testing ✅
- 40 passing tests: rate limiting, crypto (hash/HMAC/keys), quota enforcement, CDN ticket building, email templates/fallback, category derivation, utils.

## Phase 13 — Deployment ✅
- `vercel.json` (web), `infrastructure/cloudflare-worker.ts` (signed delivery), `infrastructure/README.md` (worker deploy + job scheduling), B2 + Supabase wiring docs, `.env.example` with every var, git-ready + `docs/deployment/GITHUB.md`, OpenAPI spec at `docs/api/openapi.yaml` for the public API + mobile client.

## Phase 14 — Android release 🔜
- Flutter app consuming `api.cloudcols.com`; Play Store requirements verified from official docs.

## Phase 15 — Future migration ✅ (designed)
- Repository abstraction already isolates the UI from any provider. Migration is an infrastructure task (see `ARCHITECTURE.md` §9).

---

## Explicitly deferred (not silently dropped)
- Flutter mobile & desktop clients (web-first; API is ready).
- Video transcoding / adaptive bitrate (ship native CDN range-request streaming first).
- File versioning / version history.
- Team/shared-drives (multi-user workspaces) — likely v2.
- Real-time collaborative editing.
