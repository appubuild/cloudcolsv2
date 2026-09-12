# Infrastructure

Deployment helpers and background infrastructure for CloudCols.

## Cloudflare Worker — CDN delivery

`cloudflare-worker.ts` is a second Worker, separate from the app. It validates a signed
ticket, fetches the object from the private B2 bucket with its own credentials, and
**streams** the bytes back to the reader.

```
browser ──▶ Cloudflare (this Worker) ──▶ Backblaze B2
```

The shape is the point. Backblaze and Cloudflare are Bandwidth Alliance partners, so
bytes moving from B2 into Cloudflare cost nothing — but only if they actually move
through Cloudflare. An earlier version of this Worker validated the ticket and then
`302`'d the browser to a presigned B2 URL, which sends the reader straight to Backblaze:
Cloudflare never saw a byte, nothing was cacheable, and every download was billed egress.
That is why the CDN was configured on paper and doing nothing.

Streaming is not proxying-with-buffering: `upstream.body` is handed straight to the
response, so the Worker holds no more of a 1 GB file than of a 1 KB one, and `Range`
requests pass through untouched — which is what lets a video seek and a download resume.

### Delivery classes

The ticket names one of three, and the class is **signed**, so a reader cannot edit their
own private file into a cacheable one:

| Class | What | Edge cache | Browser |
|-------|------|-----------|---------|
| `t` | thumbnail | yes, 24 h | `private, max-age=86400, immutable` |
| `s` | public share asset | yes, 5 min | `private, max-age=300` |
| `p` | private original | **never** | `private, max-age=3000` |

Edge cache keys are the object key, which begins with the owner's user id — so entries
are tenant-scoped by construction. A ranged request is never cached: a `206` is a slice,
not the object.

A private ticket also names its owner, and the worker honours it only alongside a
signed `cc_dk` cookie for the same account — so a link copied out of the network tab
does nothing in anyone else's browser. Share links carry no owner, by design.

The subrequest to B2 is made with `cache: "no-store"`. Without it Cloudflare's own
cache layer sits between the worker and B2, drops the `Range` header, fetches the
object from byte zero and discards everything before the requested offset: seeking to
90% of a 338 MB video took 33 s. With it, the same seek takes about half a second at
any depth — measured to 1.2 GB into a 1.35 GB object. The subrequest is also signed for
the method actually sent, since HEAD against a GET signature is a 403.

Share revocation is bounded rather than immediate. A ticket already issued stays valid
until it expires, and an edge entry lives out its TTL; both are capped at five minutes,
which is exactly what the presigned storage URLs this replaced allowed. Making it
immediate needs a cache purge on revoke, which needs a Cloudflare API token the app does
not currently hold.

### Deploy

```bash
wrangler deploy -c infrastructure/wrangler.jsonc

wrangler secret put B2_ACCESS_KEY_ID      -c infrastructure/wrangler.jsonc
wrangler secret put B2_SECRET_ACCESS_KEY  -c infrastructure/wrangler.jsonc
wrangler secret put CDN_TICKET_SECRET     -c infrastructure/wrangler.jsonc
```

Then point the app at it, on the **app** Worker:

```bash
wrangler secret put CDN_TICKET_SECRET     # byte-identical to the one above
# and add CDN_DOMAIN=cdn.cloudcols.com to the app's vars
```

`CDN_TICKET_SECRET` must match exactly, or every link the app issues fails signature
validation and downloads stop.

To rotate it without an outage: set the new value as `CDN_TICKET_SECRET_NEXT` on the
CDN Worker (it accepts both), move the app Worker to the new value, then set it as
`CDN_TICKET_SECRET` on the CDN Worker and delete `CDN_TICKET_SECRET_NEXT`. Leave no
second secret in place afterwards — two valid keys are two ways to mint a link.

The `cdn.cloudcols.com` DNS record does **not** need to be added by hand. The route in
`wrangler.jsonc` is declared as a `custom_domain`, so `wrangler deploy` creates the
record itself — proxied, with a certificate — and it appears in the dashboard as type
"Worker", exactly like the app's own `cloudcols.com` entry. Adding an A record manually
is the wrong shape: a Worker has no IP address to point one at.

Until both are set the app falls back to presigned B2 URLs. That works — it is what the
product ran on before — but it caches nothing and bills every byte, so `/api/health`
reports `delivery: "b2"` and warns.

### Verify

```bash
node scripts/cdn-verify.mjs
```

Runs the real Worker under `wrangler dev` against a stand-in for B2 and asserts ticket
forgery is refused, ranges come back as `206` without pulling the whole object,
thumbnails are served from the edge on the second request, and private originals never
are. 43 checks.

`scripts/media-audit.mjs` does the same against production, on real files of several
sizes: bytes actually transferred, 206s, time to first byte at depth, edge caching, and
the ownership binding on the same objects.

Against the live deployment:

```bash
curl -s https://cdn.cloudcols.com/__health
curl -sI "<ticket URL from /api/files/download>" | grep -i 'x-cdn-cache\|cache-control\|accept-ranges'
```

## Background jobs

Async jobs live in `app/api/jobs/run` (POST) and `lib/jobs/*`. In production they are
driven by the app Worker's Cron Trigger (see `../wrangler.jsonc` and `../worker/index.mjs`),
never by a normal user request.

| Job | Purpose | Schedule |
|-----|---------|----------|
| `inactivity` | warning → final warning → grace → schedule deletion | daily, 03:17 UTC |
| `trash-cleanup` | permanently delete trashed items past `TRASH_RETENTION_DAYS` | daily, 03:17 UTC |
| `webhook-delivery` | dispatch HMAC-signed events to developer webhooks | real-time + retries |

Thumbnails are **not** a job. A Worker cannot resize an image — no native binaries, no
ffmpeg — so they are generated in the browser, which already holds the file and already
has a decoder for everything it can display. See `lib/services/thumbnailer.ts` for the
upload path and `lib/services/thumbnailBackfill.ts` for files that predate it.

`/api/jobs/run` requires the `JOBS_TOKEN` secret. Without it set on the app Worker the
cron fires and every job refuses.

## Release sequence

1. `wrangler deploy -c infrastructure/wrangler.jsonc`, with the three secrets above.
2. Set `CDN_DOMAIN` and the matching `CDN_TICKET_SECRET` on the app Worker; confirm
   `/api/health` reports `delivery: "cdn"` and no warning.
3. Set `JOBS_TOKEN` on the app Worker.
4. Set `EMAIL_PROVIDER` + `RESEND_API_KEY`.
