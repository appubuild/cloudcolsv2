# Deploying to Cloudflare Workers

The app runs on Workers through OpenNext. `wrangler.jsonc` and `open-next.config.ts`
are at the repository root, so no root-directory setting is needed.

## Where variables actually live

`wrangler deploy` **replaces** the Worker's plain variables with exactly the list in
`wrangler.jsonc`. A variable added by hand in the dashboard and not written there is
deleted by the next deploy, which looks like the dashboard quietly discarding what
you typed. Secrets are managed separately and survive.

So:

- **Non-secret runtime values go in `wrangler.jsonc`** under `vars` — the Supabase
  URL and publishable key, the B2 endpoint/region/bucket, the data layer. All of
  them are public by design; none grants anything on its own.
- **Secrets go in the dashboard** (or `wrangler secret put`) and are never written
  to that file.
- **Build variables are not needed at all** — see the next section.

## Build variables are not needed

Nothing has to be set in **Settings -> Build -> Variables**. Everything the app
needs — the server and the browser both — comes from the Worker's runtime bindings.

That is deliberate. `NEXT_PUBLIC_*` values are compiled into the browser bundle
when it is built, so a value present in the Worker at runtime is invisible to a
bundle built without it, and nothing reports the mismatch: the server looks healthy
while the browser cannot sign anyone in. The server reads the public config from
its bindings and passes it through the page instead, so there is one place to
configure and it is the place that survives a deploy.

The data layer follows the same principle: the app uses the real backend unless a
build explicitly sets `NEXT_PUBLIC_DATA_LAYER=mock`. Mock data is a development
scaffold, and defaulting to it meant a misconfigured deployment quietly served
invented data rather than failing.

## First deploy

1. **Cloudflare → Workers & Pages → Create → Import a repository**, pick this repo.

2. Build settings:

   - Build command: `npx opennextjs-cloudflare build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/`

   **The build command must be `npx opennextjs-cloudflare build`, not
   `npm run build`.** Cloudflare offers `npm run build` as the default and it
   completes successfully, which makes it look right — but `npm run build` is
   `next build`, which produces `.next/`, not the Worker bundle. The deploy step
   then fails with:

   > ERROR Could not find compiled Open Next config, did you run the build command?

   `opennextjs-cloudflare build` runs `npm run build` itself and then compiles the
   result into `.open-next/`. That is also why the `build` script in `package.json`
   has to stay `next build`: pointing it at `opennextjs-cloudflare build` would make
   it call itself.

3. The Worker name in `wrangler.jsonc` must match the Worker the build is attached
   to. `wrangler deploy` reads the target from that file, not from the dashboard, so
   a mismatch quietly creates a second Worker and leaves the configured one
   untouched — with none of its secrets.

4. **Build** variables (Settings → Build → Variables and secrets):

   ```
   NEXT_PUBLIC_SUPABASE_URL       https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY  <publishable / anon key>
   NEXT_PUBLIC_DATA_LAYER         api
   NEXT_PUBLIC_APP_URL            https://<your domain>
   ```

5. **Runtime** secrets — set as secrets, never as plain variables, and never in
   `wrangler.jsonc`:

   ```
   SUPABASE_SERVICE_ROLE_KEY   full database access; it must never reach the browser
   B2_ACCESS_KEY_ID
   B2_SECRET_ACCESS_KEY
   ADMIN_TOKEN_SECRET          signs staff sessions; admin sign-in refuses to work
                               in production without it (32+ characters)
   CDN_TICKET_SECRET           only if the CDN worker is deployed
   JOBS_TOKEN                  only if the scheduled jobs endpoint is used
   RESEND_API_KEY              only if email is enabled
   ```

   Generate a value for the two `*_SECRET`s with:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

   The server does not need the Supabase URL or anon key added here: both are
   already declared in `wrangler.jsonc`, which is where they survive a deploy.

   Server code reads configuration from the Worker's own bindings rather than from
   `process.env`, because Next replaces every `process.env.NEXT_PUBLIC_X` in the
   source — server code included — with whatever was present at build time, after
   which the app "will no longer respond to changes to these environment
   variables". A `NEXT_PUBLIC_` value added at runtime would otherwise never be
   read: the expression that would read it no longer exists.

   The non-secret runtime values (`DATA_LAYER`, `B2_REGION`, `B2_ENDPOINT`,
   `B2_BUCKET`) live in `wrangler.jsonc` under `vars`, where they are visible in
   version control on purpose: none of them grant anything on their own.

6. **Backblaze CORS.** The browser uploads straight to B2, so the bucket has to allow
   the deployed origin. Without a matching rule the browser never sends the upload and
   there is no server-side trace of the failure at all. Add the real origin
   (`https://<your domain>`) to the bucket's CORS rules, with `etag` among the exposed
   headers — a multipart upload is completed by sending back each part's ETag, and a
   browser cannot read a header that is not exposed.

## Deploying from a workstation instead

```sh
npx wrangler login
npm run deploy            # opennextjs-cloudflare build && wrangler deploy
```

Build-time values come from `.env.local`, runtime ones from Worker secrets. Both files
are gitignored.

## Checking a deploy

```sh
curl https://<your domain>/api/health
```

It reports whether Supabase and B2 resolved, and which data layer is live:

```json
{"ok":true,"dataLayer":"api","providers":{"supabase":true,"b2":true}}
```

`"dataLayer":"mock"` on the client means the browser is serving fabricated data —
the `NEXT_PUBLIC_` variables did not reach the **build**. Nothing it shows is stored.

When something is missing at runtime the response names it:

```json
{"missingAtRuntime": ["SUPABASE_SERVICE_ROLE_KEY"], "warnings": ["..."]}
```

`sources` says, per variable, whether the value came from a Worker binding, from
`process.env`, or is missing. A name the dashboard clearly shows but that reads
`missing` here means the name the code reads is spelled differently — or that the
variable was added by hand and the next deploy removed it.

`build` says which build answered, so a fix that has not finished deploying is
never mistaken for a fix that did not work.

For a full check against real services, with the app running:

```sh
node scripts/e2e.mjs .dev.vars
```

That walks upload → storage → metadata → listing → download → share → revoke → trash
→ restore, and the two refusals that matter.

## Note on `vercel.json`

The project was originally built for Vercel and that file is still here. Workers
deployment does not read it; `next.config.mjs` carries the same security headers.
Delete it if the Vercel path is not wanted.

## Stripe

Nothing about Stripe lives in this repository or in Worker variables. An admin
enters the keys at `/admin/payment-gateways`, where they are encrypted before they
reach the database. The one thing the deployment needs is the key that encrypts
them:

```
SETTINGS_MASTER_KEY   a runtime secret; without it the settings can be neither
                      written nor read back
```

In Stripe, add a webhook endpoint pointing at:

```
https://<your domain>/api/webhooks/stripe
```

and subscribe it to exactly these:

| Event | Effect |
|---|---|
| `checkout.session.completed` | first payment — the plan activates and the quota rises |
| `invoice.paid` | renewal — the period is extended |
| `invoice.payment_failed` | recorded as failed; the plan is left alone, because Stripe retries for days and taking storage away on the first failure would be wrong |
| `customer.subscription.deleted` | cancelled — the account returns to free |
| `charge.refunded` | the payment is marked refunded |

Stripe issues a **new** signing secret for each endpoint you create. That is the
one to paste into the panel — not the one the Stripe CLI prints, which belongs to
`stripe listen`.

To check the whole integration against real Stripe, with the app running:

```sh
STRIPE_SK=sk_test_… STRIPE_PK=pk_test_… STRIPE_WH=whsec_…   node scripts/stripe-check.mjs .dev.vars
```

It creates a throwaway admin and user, saves the settings the way the panel does,
asks Stripe for a real checkout session, and confirms the plan is **not** granted
by starting one — then removes both accounts.
