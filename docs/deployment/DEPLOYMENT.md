# CloudCols — Deployment Guide

> Phase 1 is a mock-data web app and deploys as a standard Next.js app. This guide covers the full production topology and how the layers attach.

## 1. Web application (Next.js)

- Host on **Vercel** (native) or any Node host.
- Set env vars from `.env.example`.
- `npm ci && npm run build && npm run start`.

**SEO/robots:** public marketing routes are indexable; `/app`, `/admin`, `/developers`, and `/s/[token]` should be non-indexed.

## 2. Supabase (Auth + Postgres metadata)

- Create a project. Enable email auth; configurable: email verification, magic link, OAuth (optional).
- Run migrations to create the metadata tables, indexes, and **Row Level Security** policies so users can only read/write their own rows.
- The **service-role key is server-only** and never enters any client bundle.

## 3. Backblaze B2 (object storage)

- Create a bucket (private by default). Create an application key with Bucket Read/Write + List scopes — **server-only**.
- **Object key convention:** `{userId}/user-files/{category}/{yyyy}/{mm}/CC-{uuidV4}.{ext}` — original filename is metadata only.
- **Bandwidth Alliance** with Cloudflare makes egress from B2 free/cheap. Verify current pricing/limits in official docs before production.

## 4. Cloudflare (CDN + delivery worker)

- Map a custom domain to the bucket as a public bucket (for CDN delivery of public/thumbs) — or better, use a **Cloudflare Worker** that validates short-lived signed URLs before proxying to B2.
- Private content: the API issues a short-TTL signed URL; the worker validates and streams; **do not** cache signed private URLs publicly.
- Thumbnails: serve from a `derivatives/` prefix with immutable cache headers.

## 5. Payments (provider adapter)

- Implement provider adapters (card / crypto / Play Billing). Never hard-code a provider.
- Verify provider webhooks server-side; record `Payment` rows and update `Subscription`/quota.

## 6. Delivery path (never proxy large bytes)

```
Upload:   client ──presigned PUT──► B2
Download: client ──signed URL GET──► Cloudflare Worker ──► B2
```

The API server only issues permission and handles metadata.

## 7. Observability & cost monitoring

- Structured logs (no secrets/passwords).
- Health checks + uptime monitoring for API/CDN.
- Track B2 storage + transactions, Cloudflare requests + cache ratio, Supabase usage/egress, API request volume; alert before quotas are exhausted.

## 8. Backups

- **Database:** automated Postgres backups for metadata/config.
- **Files:** B2 object durability/versioning/bucket lifecycle (configurable) — database backup ≠ file backup.

## 9. Environment separation

- `development` / `staging` / `production` configs. Secrets only in server env vars. Feature flags (`ADS_ENABLED`, `DEVELOPER_PLATFORM_ENABLED`, `MAINTENANCE_MODE`) drive behavior without redeploys.

## 10. Admin content-access boundary

The admin Storage Operations UI is metadata-only. Content access is a separate, audited, Super-Admin-only flow for legal/abuse investigations. Never place a casual "preview" at the file row.
