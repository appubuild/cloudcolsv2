# CloudCols — Architecture

CloudCols is a cloud storage & media platform (Google Drive / Dropbox class). This document describes the target production architecture, what is implemented in Phase 1, and how to migrate from mock data to a real backend without rewriting the UI.

## 1. Product & motivation

- Store, organize, preview and share files.
- Free + paid storage plans, plus a **separate** Developer API product (own plans, billing, rate limits, usage, webhooks).
- One identity system: a user account can optionally enable developer mode (the Developer platform is a *capability*, not a separate account type).
- A role-based internal **Admin Panel** for operating the business.

## 2. Client stack (this repository)

- **Next.js 14 (App Router) + TypeScript + Tailwind** — one codebase, four route groups:

| Route group | Purpose |
|-------------|---------|
| `(marketing)` | Public site: `/`, `/features`, `/pricing`, `/security`, `/privacy`, `/terms` |
| `(auth)` | `/login`, `/register`, `/forgot-password`, `/verify-email` |
| `(app)` | Product: `/app/*` (files, folders, media, share, storage, settings) |
| `(developers)` | Developer portal: `/developers/*` (keys, docs, usage, webhooks, billing) |
| `(admin)` | Internal ops: `/admin/*` |
| `s/[token]` | Public share view |

- **State:** React Query for server-state (on top of the repository layer) + Zustand for light UI state (theme, view mode, upload tray, toasts, auth mirror).
- **Design system:** one brand primary + neutral scale + semantic tokens + CSS variables for light/dark. Consistent spacing, radius, shadows.

## 3. Target production architecture

```
Browser / Mobile / Desktop
        │
        │  auth (Supabase session) or API key for /v1
        ▼
  CloudCols API server  (= Next.js route handlers on api.cloudcols.com)
        │  validates: identity, ownership, quota, permissions, rate limits
        ├──► Supabase Postgres  (metadata only — NEVER large binaries)
        ├──► Supabase Auth      (sessions, tokens)
        ├──► Backblaze B2       (issues short-lived presigned upload/download URLs; bytes NEVER pass through the API)
        └──► Payment provider adapter (card / crypto / Play Billing)

Browser ──(presigned PUT)──► Backblaze B2          ← upload, direct
Browser ──(signed URL GET)──► Cloudflare CDN ──► B2 ← download/stream, edge-cached where safe
```

**Golden rule: the API server issues permission, never proxies large bytes.**

- Upload: `client → presigned upload URL → B2` (never through the API server).
- Download/stream: `client → short-lived signed URL → Cloudflare → B2`. Private content is signed per-request (short TTL) and not publicly cached; public share content may be edge-cached.

## 4. Data model

Metadata lives in PostgreSQL (via Supabase). Large binaries live in B2. Core shapes are in `lib/types/index.ts` and mirror the future SQL tables:

`User`, `Folder`, `File`, `ShareLink`, `Plan`, `Subscription`, `Payment`, `ApiPlan`, `ApiKey`, `ApiRequestLog`, `Webhook`, `Notification`, `AuditLog`, `AdminUser`.

### Object key convention (never the original filename)

```
{userId}/user-files/{category}/{yyyy}/{mm}/CC-{uuidV4}.{ext}
```

The original filename is **metadata only**, used for display. The storage key is generated server-side. Categories are derived server-side from MIME type + extension — never trusted from the client.

## 5. Storage abstraction (future-proofing)

`FilesRepository` and friends in `lib/repositories/types.ts` define the interface. Two implementations:

- `lib/repositories/mock/*` — **Phase 1**, in-memory + localStorage with realistic latency, ownership checks, quota checks, category derivation, and error injection.
- `lib/repositories/api/*` — **Phase 2**, calls `api.cloudcols.com/v1` and implements the *same* interface.

**No UI component imports mock data directly.** Everything flows through React Query hooks → repository. Swapping to the real API = swapping repository implementation; the UI is untouched.

## 6. Caching layers

1. Browser/Flutter local cache (React Query + immutable asset headers).
2. CDN cache (thumbnails, public share content).
3. Application cache (metadata, config) — as needed.
4. Database (Postgres indexes).

Caching strategy: TTL on config/profile/metadata; invalidation on create/rename/move/delete/share; authorization decisions are never cached forever; private data is never cached in a way that leaks across users.

## 7. Delivery & cost principles

- B2 for storage (pay-as-you-use), Cloudflare for CDN/edge.
- No large-file proxying through the app server.
- Duplicate large files avoided; object storage durability used rather than double-in-memory copies.
- Paid infrastructure is only introduced at actual scale.

## 8. Security model

- Server is the source of truth for identity, ownership, quota, billing, permissions, rate limits.
- Client trusted only for UI state, playback, rendering, progress, caching.
- Every destructive/financial/security action is **audit-logged**.
- Signed, short-TTL URLs for download/preview; presigned, scope-limited URLs for upload.
- MIME + extension allow-list at upload-confirm; filenames sanitized for display; storage key fully server-generated (path traversal impossible).
- Rate limiting on login/register/share/API endpoints.
- RBAC enforced server-side for admin routes; UI hiding is cosmetic only.
- Secrets (B2, Supabase service role, payment, Cloudflare) only in server env vars — never in the browser bundle.

### Admin content-access boundary (metadata vs content)

- **Metadata access** (default): filenames, size, type, owner, dates, sharing status — the default admin view.
- **Operational access** (Support/Super): suspend, quarantine, force-delete, restore — actions on records, not bytes.
- **Content access** (Super Admin only, with a logged reason, ideally time-boxed): actually viewing a user's private file — reserved strictly for legal/abuse investigation, deliberately friction-heavy. The default Storage Operations UI never places a "preview" eye/thumbnail next to user files.

## 9. Migration path (Supabase → dedicated infrastructure)

The UI depends only on repository interfaces. Migrating is an infrastructure task:

1. Implement `Api*` repositories against the new API.
2. Point the Flutter/Next client at `api.yourdomain.com`.
3. The API server moves off Next route handlers to a standalone server (Docker + Node) talking to dedicated Postgres (and Redis only when needed), B2, Cloudflare.
4. No Flutter/UI rewrite required.

## 10. Implementation status (Phase 1)

Full mock-data web app:

- ✅ Auth (login/register/reset) + role-gated routing
- ✅ File manager (browse/folders/grid+list/breadcrumbs/sort/search)
- ✅ CRUD: create folder, rename, move, delete→trash, restore, destroy, favorite
- ✅ Upload tray (progress, speed, ETA, cancel, retry, quota + size checks)
- ✅ Categories (server-derived)
- ✅ Preview overlay (image/video/audio/pdf/other)
- ✅ Sharing (create/revoke via modal + Shared list) + public share page states
- ✅ Storage page (usage ring, category breakdown, plans)
- ✅ Settings (profile/security/notifications/billing/danger)
- ✅ Developer portal (dashboard, keys, docs, usage, webhooks, billing) + enablement flow
- ✅ Admin panel (dashboard, users, storage, plans, subscriptions, payments, API, ads, content, security)
- ✅ Marketing site (home, features, pricing, security, privacy, terms)

Phase 1 uses a **repository abstraction** with mock data so the swap to a real backend is a drop-in replacement.
