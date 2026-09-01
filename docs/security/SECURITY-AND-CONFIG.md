# CloudCols — Configuration, Credentials & Security Guide

This is the single reference for **connecting real Supabase + Backblaze B2** and for
the security posture. It covers both the **web app** (`cloudcols/`) and the
**Flutter app** (`flutter-project/`).

---

## 1. How authentication, storage & metadata flow

```
Flutter app ──► our API ──► Supabase (auth + Postgres metadata)
   │                        └── B2 presigned/signed URLs for bytes
   ▼
Browser (web) ─► our API ──► same Supabase + B2
```

- **Supabase** = auth (JWT) + the Postgres database (files, folders, backup jobs…).
- **Backblaze B2** = the actual file bytes (S3-compatible).
- The app server signs short-lived URLs; **the server never proxies large files**.
- A single user account (the Supabase JWT) works across **web and Flutter**.

---

## 2. Configure Supabase (real)

### 2.1 Create the project
1. Login to [supabase.com](https://supabase.com) → **New project**. Choose a region near you.
2. Note the **Project URL** (e.g. `https://abcdefgh.supabase.co`) and the
   **anon public key** (Settings → API).

### 2.2 Run the migrations
The schema lives in `supabase/migrations/0001…0007`. Apply them **in order**:

```bash
cd cloudcols
# via the Supabase CLI:
supabase link --project-ref <your-project-ref>
supabase db push
# or run each migration in the SQL editor in order 0001 → 0007
```

This creates: `user_storage`, `folders`, `files`, `share_links`, `notifications`,
`audit_log`, `developer_*`, `admin_*`, `backup_jobs`, `backup_job_items`, and
`site_content` — all with **Row Level Security** and the `create_backup_job` RPC.
Admin role grants live in `0004_admin_rbac.sql`; the dashboard touches live in
`0005_dashboard.sql`; backup tables in `0006_backup_jobs.sql`; the landing-page
CMS (`site_content`) in `0007_site_content.sql`.

### 2.3 Secrets split (critical)
| Variable | Where it lives | Browser-visible? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | ✅ yes (safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | ✅ yes (safe — anon) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | ❌ **never** |

> The anon key is designed to be public. The **service-role key bypasses RLS** and
> must never be imported by any `app/*` client component. It is only read in
> `lib/supabase/server.ts` (server-only), guarded by `createAdminClient()`.

---

## 3. Configure Backblaze B2 (real)

1. Create a bucket in B2 (e.g. `cloudcols-files`).
2. Create an **Application Key** with *read + write* on that bucket.
   - Note the **application key ID** and **application key (secret)**.
3. **Public access / CDN**: map a custom domain to the bucket (B2 → Bucket →
   Bucket Settings → Public/Custom Domain), or put Cloudflare in front. Set
   `B2_PUBLIC_DOMAIN` and the Cloudflare `CLOUDFLARE_WORKER_URL` / `CDN_DOMAIN`.

```env
B2_ENDPOINT=https://s3.us-west-000.backblazeb2.com
B2_BUCKET=cloudcols-files
B2_ACCESS_KEY_ID=<application-key-id>        # SERVER ONLY
B2_SECRET_ACCESS_KEY=<application-key>       # SERVER ONLY
B2_PUBLIC_DOMAIN=files.yourdomain.com
```

Presigned URL upload (`lib/services/b2.ts`) uses `S3Client` with `forcePathStyle:
true`. The client uploads **directly** to the presigned URL — bytes never pass
through the app server.

---

## 4. Enable the real data layer on the WEB

1. Create `.env.local` from `.env.example` and fill the real values.
2. **Both** of these must be set (the client can only read the `NEXT_PUBLIC_` one):

```env
NEXT_PUBLIC_DATA_LAYER=api     # what the browser repository facade reads
DATA_LAYER=api                 # server alias (kept in sync)
```

> This is important: Next.js inlines only `NEXT_PUBLIC_*` into the browser bundle.
> `DATA_LAYER` alone is unreachable by client code, so the repo switch MUST be
> `NEXT_PUBLIC_DATA_LAYER`.

3. Restart the dev server (`npm run dev`). The repository facade flips to the live
   API with **zero UI changes**.

---

## 5. Point the FLUTTER app at the real API

Flutter never holds B2/Supabase service-role secrets. It talks to **your API**,
which returns short-lived presigned URLs.

```bash
cd flutter-project
flutter pub get
# Mock (default) — runs fully offline with realistic data:
flutter run

# Real API — point at the backend:
flutter run \
  --dart-define=ENVIRONMENT=prod \
  --dart-define=API_BASE_URL=https://app.yourdomain.com \
  --dart-define=API_VERSION=/api
```

- `ENVIRONMENT=prod|dev` flips `isApiEnabled` in `core/config/app_config.dart`,
  which binds the `*ApiRepository` implementations in `core/di.dart` (mock → api)
  with no UI edits.
- The session token from `/api/auth/login` is stored in **`flutter_secure_storage`**
  (not shared prefs) and attached as `Authorization: Bearer <token>` on every call.
- `ApiBackupRepository.uploadItem` requests an **upload ticket** → streams local
  bytes to the presigned B2 URL → confirms. The app never sees a B2 secret.

---

## 6. Environment variables in `flutter-project`

Configured via `--dart-define` only (no hard-coding, no secrets):

| Flag | Purpose |
|---|---|
| `ENVIRONMENT` | `mock` (default) \| `dev` \| `prod` |
| `API_BASE_URL` | backend base URL (empty in mock mode) |
| `API_VERSION` | path prefix, default `/v1` (set to `/api` to match the web routes) |
| `APP_NAME` / `SUPPORT_EMAIL` | optional branding |

---

## 7. Production checklist

**Before you ship to a public host:**
- [ ] Run all migrations `0001 → 0007` (else RLS/backup tables + CMS are missing).
- [ ] Fill `SUPABASE_SERVICE_ROLE_KEY`, `B2_*`, `CDN_TICKET_SECRET`, `JOBS_TOKEN`,
      `RESEND_API_KEY`, and payment/Cloudflare secrets **on the server only**.
- [ ] Verify client bundles contain **no** service-role/B2/Cloudflare secret.
      Grep `build/` for them after `next build`.
- [ ] Set `NEXT_PUBLIC_*` for anything the browser needs.
- [ ] `NEXT_PUBLIC_DATA_LAYER=api` + `DATA_LAYER=api` (keep in sync).
- [ ] Set `NEXT_PUBLIC_FEATURE_MAINTENANCE_MODE=false`.
- [ ] Confedrm `X-Frame-Options: DENY` / `frame-ancestors 'none'` are present
      (mitigates clickjacking for the authenticated app).
- [ ] Rate limits are applied (see §8).

---

## 8. Security audit — findings & actions

**Verified good:**
- ✅ Server secrets (`supabaseServiceRoleKey`, `B2_*`, `CDN_TICKET_SECRET`) appear
  **only** in `lib/` (server-only) and `app/api/*` route handlers — never in `app/`
  client components. The one `app/` reference is `app/api/health/route.ts`, a
  **server** route.
- ✅ `NEXT_PUBLIC_DATA_LAYER` is the only client-visible data-layer switch; client
  code never reads `process.env.DATA_LAYER`.
- ✅ Auth — `requireUser` validates the Supabase JWT on every `/api/*` call; all
  new backup routes (`/backups/jobs*`) call it and are `force-dynamic`.
- ✅ `handler`/`limited` send `cache-control: no-store` and never leak stack
  traces (5xx becomes a generic message).
- ✅ RLS enabled on all tables incl. `backup_jobs` / `backup_job_items`.
- ✅ The Flutter app cannot reach B2 service-role/secret keys (presigned-only).
- ✅ No real credentials requested during development (mock-first).

**Applied this pass:**
- ⬅️ **`POST /api/backups/jobs` rate-limited** by client IP (`limited(..., DEFAULT_LIMITS.backupJob)`, 30/min). Previously it used `handler` with no throttle, so it could be spammed to create many rows. Added `backupJob` to `DEFAULT_LIMITS`.

**Recommendations for production (not blocking in mock-first/dev):**
- Apply `limited` to the item-create `POST /api/backups/jobs/[id]/items` and to
  `POST /api/files/upload-ticket` if not already limited (upload creation is an
  abuse surface — the existing `uploadTicket` limit exists; wire it if unused).
- Move the in-memory rate-limiter to **Redis** when scaling beyond one instance
  (the interface already isolates this in `lib/api/rateLimit.ts`).
- Enforce **size + quota checks** on upload receipt (already present via
  `getQuota`/`assertCanUpload` — confirm the mobile backup path calls the same).
- Add a CSP/security-header middleware (`X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, CSP) for production.

---

## 8b. Landing-page CMS (site_content)

The public landing page copy (hero, feature grid, CTA) is editable at runtime
from **Admin → Content → Landing**, without a rebuild.

- Stored as a single JSONB document in `public.site_content` keyed `key = 'landing'`
  (`0007_site_content.sql`). Apply migrations in order 0001 → 0007.
- **Read:** `GET /api/content/landing` (public) — server `getLanding()` merges the
  saved partial over `DEFAULT_LANDING`, so the page **never breaks** if the row is
  missing. The marketing page is `force-dynamic` and falls back to defaults on any
  DB/error.
- **Write:** `PATCH /api/content/landing` — guarded by `requireAdmin(req, "operator")`
  (admin JWT). It upserts `{ key, content, updated_at }`.
- **RLS:** deny-by-default (`site_content_none`). All reads/writes go through the
  API layer; the public GET uses the service-role admin client, so RLS is not the
  enforcement point for writes.
- **No hardcoded runtime copy** — the only copy source is `lib/content/landing.ts`
  (defaults) merged with saved DB content. No client secrets involved.

---

## 9. How to run everything locally with mocks (no credentials needed)

```bash
# Web (mock data layer — no Supabase/B2 needed)
cd cloudcols
npm ci
NEXT_PUBLIC_DATA_LAYER=mock DATA_LAYER=mock npm run dev

# Flutter (mock repositories — runs fully offline)
cd flutter-project
flutter pub get
flutter run
```

Both projects run and test **without any real credentials**. When you add real
credentials later, only `.env.local` (web) and `--dart-define` (Flutter) change —
no source code.
