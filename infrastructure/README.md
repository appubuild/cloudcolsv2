# Infrastructure

Deployment helpers and background infrastructure for CloudCols.

## Cloudflare Worker — signed CDN delivery

`cloudflare-worker.ts` validates a short-TTL HMAC-signed ticket (`key`, `exp`, `sig`) and
streams the object from the private B2 bucket. This keeps files private (never proxied
through the Next.js app) while serving through the edge.

Deploy (from this folder):

```bash
npm i -g wrangler
wrangler deploy
```

Set worker env (secrets, never committed) via `wrangler secret put`:

- `CDN_TICKET_SECRET` — shared HMAC secret, must match the app's `CDN_TICKET_SECRET`.
- If you use the presign path: `B2_ENDPOINT`, `B2_BUCKET`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY`.

The worker serves `GET /v1/object?key=...&exp=...&sig=...` and reports health at `/__health`.

The app generates these tickets in `lib/services/cdn.ts` (`buildCdnUrl`). Tickets are valid
1 hour by default.

> This is the recommended topology. Do **not** point the app at a public B2 bucket for
> originals — always sign.

## Background jobs

Async jobs live in `app/api/jobs/run` (POST) and `lib/jobs/*`. They are triggered by a
scheduler in production (e.g. a `pg_cron` job or an external cron that POSTs to
`/api/jobs/run`), never by a normal user request.

| Job | Purpose | Schedule (suggested) |
|-----|---------|----------------------|
| `inactivity` | warning → final warning → grace → schedule deletion | daily |
| `trash-cleanup` | permanently delete trashed items past `TRASH_RETENTION_DAYS` | daily |
| `thumbnail` | generate thumbnails for previewable uploads | on-demand (queue) |
| `webhook-delivery` | dispatch HMAC-signed events to developer webhooks | real-time + retries |

Each job is audited in `audit_logs`.

With the Supabase-hosted DB you can schedule with `pg_cron`:

```sql
select cron.schedule('inactivity-diurno', '0 3 * * *', $$ select net.http_post('https://app.example.com/api/jobs/run', '{"name":"inactivity"}') $$);
```

Replace the URL with your deployed app URL. Keep `/api/jobs/run` protected in production
(see `app/api/jobs/run/route.ts` — restrict by an internal key before release).

## Recommended release sequence

1. `wrangler deploy` for the worker (set `CDN_TICKET_SECRET` here and in app env).
2. Set the app's `CDN_DOMAIN` to the worker URL.
3. Schedule jobs (pg_cron / external cron).
4. Set `EMAIL_PROVIDER` + `RESEND_API_KEY`.
