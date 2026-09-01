# Web Project Completion Audit

Evaluated against the full requirement set (marketing · auth · product · developer · admin · security · storage · supabase/B2/API wiring). Evidence gathered by inspecting the actual source and running typecheck, tests, and build.

**Current running state:** `DATA_LAYER=mock` → the app runs the Phase-1 **mock** implementation. The Phase-2 API/backend layer (route handlers + `Api*` repositories) is **code-complete but not exercised end-to-end** because no Supabase/B2 credentials are configured yet (by design). Gaps below are *code* gaps that would surface when switching to `DATA_LAYER=api`, plus a few *mock-only* stubs.

Verification baseline: typecheck clean · **40/40 tests pass** · production build succeeds (42 pages · 42 API routes).

---

## ✅ Fully completed

**Marketing site** — `/`, `/features`, `/pricing`, `/security`, `/privacy`, `/terms`. Responsive, branded, dark/light. (Content is fully **hard-coded**, not DB-driven — see Landing CMS note.)

**Auth (app users)** — register, login, logout, forgot-password (supabase reset), role-gated routing. Server validates the Supabase Bearer token on every `/api/*` call (`requireUser` → service-role `getUser`). Tokens never touch the browser bundle secrets.

**File management** — folders (clean URLs), grid/list, breadcrumbs, search (debounced), sort, filter, rename, move, delete→trash, restore, permanent delete, favorites, recent, bulk actions, drag-and-drop; one shared File-List engine for Recent/Favorites/Trash/Categories.

**Upload tray** — progress %, speed, ETA, cancel, retry, quota + max-file-size checks; **direct-to-B2** presigned PUT (never proxied through the app server). Categories derive server-side from MIME+extension.

**Preview overlay** — image, video, audio, PDF, other.

**Sharing** — create/revoke (view/download, expiry), public share page (`/s/[token]`) with explicit states (valid/expired/revoked/not-found).

**Storage page** — usage ring by category, plan comparison, quota enforcement.

**Settings (UI)** — profile, security, notifications, billing & plan, danger zone tabs.

**Developer portal** — enablement, scoped API keys (secret shown once, hashed at rest), docs, usage analytics, webhooks, billing. Separate product from storage plans. Public `/v1` contract documented in `docs/api/openapi.yaml`.

**Admin panel (UI)** — dashboard, users, storage, plans, subscriptions, payments, API, ads, content, security. Tab consolidation done.

**Design system / UI** — light+dark, semantic tokens, responsive (mobile drawer + desktop sidebar), accessible.

**Database/architecture** — 3 migrations: schema+RLS+quota trigger; developer/payments/audit tables; query indexes. Repository facade swaps mock⇄api with zero UI change (verified: no UI imports mock directly).

**Security layer** — rate limiting (sliding-window, 429), API keys hashed at rest, HMAC-signed webhooks + signed CDN tickets, server-generated opaque object keys (no path traversal), server-side quota/max-file-size, CORS allowlist helper, security headers (X-Frame-Options, Referrer-Policy, Permissions-Policy), `no-store` on API payloads. Background jobs: webhook delivery, trash cleanup, inactivity lifecycle. Audit logging for destructive/security actions.

---

## ⚠️ Partially completed (exists but incomplete / has defects)

1. **Admin panel backend is a stub.** The admin API routes (`/api/admin/stats|users|payments|audit`) each return `501 NOT_IMPLEMENTED`. Admin *UI* is complete against the mock repo, but flipping to `api` yields 501s on every admin page.
2. **Admin auth is mock-only.** `/admin/login` accepts hard-coded creds and stores `cloudcols.admin.v1` in `localStorage`. No real admin session, no server-side RBAC; admin API routes only call `requireUser` (a normal user), so **no admin role is enforced server-side**.
3. **`subscription.cancel` is broken.** The repository calls `POST /api/subscriptions/cancel` but the route only exports `GET` **and** is a `501` stub.
4. **`updateProfile` is a no-op in API mode.** The Settings→Profile save calls `authRepo.updateProfile(id,{name})`, but `ApiAuthRepository.updateProfile` ignores the patch and just re-returns the profile. Editing a name does nothing against the real backend.
5. **Upload MIME type is lost.** `createUploadTicket` hard-codes `application/octet-stream`, so in API mode every upload would be categorized `other` (category derives from MIME, not extension) — breaking the auto-categorization feature.
6. **Password change is a mock.** Settings→Security "Update password" is a `setTimeout` fake with no backend call.
7. **MIME allow-list not enforced at upload-confirm.** The architecture specifies a MIME+extension allow-list at upload-confirm as a security control. Not implemented.

---

## ❌ Missing

1. **Landing Page Management (CMS)** — the marketing landing page content is hard-coded in `app/(marketing)/page.tsx`. No admin-driven section visibility, ordering, hero/CTA/pricing/FAQ/testimonial/footer editing, or SEO/meta config. (Explicitly a **future** feature per your brief — not required for this release, but flagged.)
2. **Real 2FA** — UI placeholder only ("Not yet enabled in the demo").
3. **Multipart/resumable large-file uploads** — single-shot presigned PUT only.
4. **Public `/v1` REST facade** — OpenAPI spec + server-side `lib/api/developer.ts` helpers exist, but there's no actual `/v1/*` router implementing the documented contract end-to-end (developer *portal* endpoints `/api/dev/*` do exist).
5. **Admin RBAC** — no role model enforced server-side (see #2).

---

## 🛠 Fixes applied after this audit (before Flutter)

The items below were **implemented and verified** (typecheck clean · 45/45 tests · production build succeeds · 47 API routes):

| # | Fix | Status |
|---|-----|--------|
| 1 | Real admin endpoints: `/api/admin/login|me|logout|stats|users|payments|audit` backed by Postgres | ✅ |
| 2 | Real admin auth + server-side RBAC (`lib/api/adminAuth.ts`, HMAC-signed staff JWT, hierarchy super_admin/support/operator; `admins` table in migration `0004`). Client admin store + login use the API in `api` mode (demo fallback in `mock`). | ✅ |
| 3 | `POST /api/subscriptions/cancel` real implementation + repo method corrected | ✅ |
| 4 | `PATCH /api/profile` endpoint + `updateProfile` now persists | ✅ |
| 5 | Real MIME type threaded through upload (`UploadTask` → `enqueueUploads` → repo → `/api/files/upload-ticket`) so categories are correct | ✅ |
| 6 | MIME/extension allow-list enforced at upload-confirm (`lib/services/mime.ts`, blocks executables/disguises, safe canonical MIME; verified by tests) | ✅ |
| 7 | `POST /api/auth/change-password` (verifies current via Supabase, then updates; audited) + Settings→Security wired to it | ✅ |
| 8 | **Critical fix:** `DATA_LAYER` is a server-only env value that Next does **not** inline into the browser bundle, so the repository facade's `mock⇄api` switch was always `mock` on the client. Added `NEXT_PUBLIC_DATA_LAYER` (client-readable, inlined) with a server `DATA_LAYER` alias. | ✅ |

## Remaining deferred (not blocking)

- Landing Page CMS, real 2FA, multipart/resumable uploads, public `/v1` facade, Android/Flutter build.

## 🔜 Deferred (not blocking; per your directions)

- Landing Page CMS, real 2FA, multipart/resumable uploads, public `/v1` facade, Android/Flutter build.

---

## Auth architecture recommendation (for Flutter)

Keep **Supabase Auth on the client** for obtaining a session token (both web and Flutter use the SDK), and **validate that token on every API call** via the service-role `getUser` in the server (`requireUser`). This is the current design and is the right call here:

- Same account across Web + Flutter (both use the same Supabase Auth project → same JWT).
- Credentials (Supabase service-role, B2 secrets) never ship in the app binary; the client only holds its own short-lived JWT + anon key.
- The API server remains the authority on identity, ownership, quota, permissions, and rate limits for every operation — so **all business logic stays centralized** and Flutter never re-implements it.
- Real-time/live features (notifications) *may* connect Supabase directly via the client socket using the same JWT — that is a legitimately-better direct connection (low latency, no proxy). Everything else goes through our API.

**B2/upload via API:** Flutter requests a presigned PUT GET URL from our API (like web) and streams bytes directly to B2 / a signed CDN ticket. No B2 secret in the app.

## Bottom line

The **mock-data web app is feature-complete** and the **backend/API layer is substantially built**. What's genuinely incomplete is concentrated in: **(a) admin panel backend + RBAC**, **(b) account/password/profile wiring**, and **(c) upload category MIME + allow-list security**. These are the items to finish before starting the independent Flutter app.
