# Wiring your real providers (Supabase + Backblaze B2 + Cloudflare)

Phase 2 connects the app to your live infrastructure. Once you fill in the values below, switch `DATA_LAYER=api` and the entire app runs against your real Supabase + B2, served through Cloudflare — with **no UI changes** (the repository facade handles the swap).

## 1. What I already built

| Piece | File(s) |
|-------|---------|
| Supabase schema + RLS + quota trigger | `supabase/migrations/0001_init.sql` |
| Server-side Supabase admin client | `lib/supabase/server.ts` |
| Browser auth client | `lib/supabase/client.ts`, `lib/api/client.ts` |
| B2 S3-compatible presign/head/delete | `lib/services/b2.ts` |
| Server auth helper (Bearer JWT → user) | `lib/api/auth.ts` |
| Quota enforcement (never trust client) | `lib/api/quota.ts` |
| File category derivation + object keys | `lib/storage/categories.ts` |
| API route handlers | `app/api/**` (auth, files, folders, health) |
| API-backed repositories (drop-in swap) | `lib/repositories/api/index.ts` |
| Repository facade (mock ⇄ api switch) | `lib/repositories/index.ts` |

## 2. Backblaze B2 setup

1. Create a private bucket (e.g. `cloudcols-files`). Keep it **private** — no public read.
2. Create an **Application Key** with Bucket Read/Write + List scopes (server-only).
3. Note the **S3 Endpoint** (Settings → Show S3 credentials) — looks like `https://s3.us-west-000.backblazeb2.com`.
4. (Optional) Connect a custom domain for delivery; better, use the Cloudflare Worker for signed delivery (below).

## 3. Supabase setup

1. Create a project (free tier is fine to start).
2. Run the migrations: in the Supabase SQL editor, paste `supabase/migrations/0001_init.sql` then `0002_developer_payments_audit.sql` and run them. These create `user_storage`, `folders`, `files`, `share_links`, plus `api_plans`, `api_keys`, `api_request_logs`, `webhooks`, `subscriptions`, `payments`, `audit_logs` — with Row Level Security and the quota-recompute trigger.
3. Auth → get the **Project URL** and **anon key** (client-safe) and the **service-role key** (server-only).
4. Auth providers → enable Email (if you want magic links/verification).

## 4. Cloudflare (signed CDN delivery)

Private objects are never proxied through the app servers (per architecture). Two options:

**Option A — Signed worker (recommended, keeps B2 fully private).**
A Cloudflare Worker (`infrastructure/cloudflare-worker.ts`) validates a short-TTL HMAC-signed ticket and streams the object from the private B2 bucket. The client only ever holds the ticket — never a B2 key.

Deploy:
```bash
cd infrastructure
wrangler deploy
```
Secrets (never committed): `CDN_TICKET_SECRET` (a long random HMAC secret), plus `B2_ENDPOINT`, `B2_BUCKET`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY` in `[vars]`/`[secrets]` of the worker.

**Option B — B2 custom domain.**
Map a Cloudflare custom domain to the bucket. Simpler, but the object URL is guessable, so only use for the `/derivatives/` thumbnails (non-sensitive) — never for originals.

## 5. Environment

Fill `.env.local`:

```bash
# Client must see the switch → use NEXT_PUBLIC_DATA_LAYER (Next inlines it).
NEXT_PUBLIC_DATA_LAYER=api
DATA_LAYER=api

NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service-role key>        # SERVER ONLY

B2_ENDPOINT=https://s3.us-west-000.backblazeb2.com
B2_REGION=us-west-000
B2_BUCKET=cloudcols-files
B2_ACCESS_KEY_ID=<application key id>               # SERVER ONLY
B2_SECRET_ACCESS_KEY=<application key>              # SERVER ONLY
B2_PUBLIC_DOMAIN=files.yourdomain.com               # optional (fallback / thumbs)

# Optional — signed CDN delivery (worker). Server process reads these.
CDN_TICKET_SECRET=<long random secret>              # server reads, never in browser
CDN_DOMAIN=https://cdn.yourdomain.com               # your worker URL

# Optional — email (defaults to console logging if unset)
EMAIL_PROVIDER=resend                                # console | resend | smtp | custom
RESEND_API_KEY=<resend key>                          # SERVER ONLY
EMAIL_FROM="CloudCols <noreply@yourdomain.com>"     # SERVER ONLY
NEXT_PUBLIC_APP_URL=https://app.yourdomain.com      # link domain in emails

# Optional — background job policy (see infra/README)
INACTIVITY_DAYS=90
INACTIVITY_WARNING_DAYS=30
INACTIVITY_FINAL_WARNING_DAYS=15
INACTIVITY_GRACE_DAYS=7
TRASH_RETENTION_DAYS=30
```

## 6. Run

```bash
npm run dev
```

- `/api/health` reports `ok:true` and whether Supabase/B2 are configured.
- Auth, file listing, folder CRUD, rename/move/favorite/trash/restore, upload tickets, and presigned download URLs now go through your real Supabase + B2.
- Uploads PUT directly to B2 via the returned presigned URL; the server verifies the object (HEAD) and syncs quota via the Postgres trigger.

## 7. Verify provider rules before release

Per the brief, confirm current official docs for: B2 pricing/egress + bandwidth allocation, Supabase free-tier limits, Cloudflare cache/request behavior, and signed-URL capabilities. Prices/limits change; don't assume.
