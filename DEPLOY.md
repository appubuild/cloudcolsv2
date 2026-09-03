# Deploying to Cloudflare Workers

The app runs on Workers through OpenNext. `wrangler.jsonc` and `open-next.config.ts`
are at the repository root, so no root-directory setting is needed.

## The one thing that catches people

Cloudflare has **two** places called "Variables and secrets", and they do different
jobs:

| Where | Reaches | Use for |
|---|---|---|
| Worker → Settings → **Build** → Variables and secrets | the build only | `NEXT_PUBLIC_*` |
| Worker → Settings → **Runtime** (or `wrangler secret put`) | the running Worker | everything the server reads |

`NEXT_PUBLIC_*` values are **baked into the browser bundle when the bundle is built**.
Setting them only at runtime leaves them empty in the shipped JavaScript, and the app
fails with something unhelpful like "authentication is not configured". Setting them
only at build time is fine for those, because nothing reads them at runtime.

Everything else is the opposite: it is read by the server on each request, so it has
to be a runtime value.

**`NEXT_PUBLIC_DATA_LAYER` needs to be in both places.** The client reads the
`NEXT_PUBLIC_` copy (inlined at build), the server reads `DATA_LAYER` (runtime). If
they disagree, the browser and the server use different backends.

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

   The server also needs the Supabase URL and anon key. Set them at runtime under
   the **plain** names:

   ```
   SUPABASE_URL
   SUPABASE_ANON_KEY
   ```

   Not the `NEXT_PUBLIC_` versions. Next replaces every `process.env.NEXT_PUBLIC_X`
   in the source — server code included — with whatever was present at build time,
   and the app then "will no longer respond to changes to these environment
   variables". Adding a `NEXT_PUBLIC_` name as a runtime variable therefore does
   nothing at all: the expression that would have read it no longer exists.

   (The app reads the plain names as a fallback and also does a dynamic lookup that
   Next cannot inline, so a `NEXT_PUBLIC_` runtime value is picked up too. The plain
   names are still the ones to use — they behave the way the dashboard implies.)

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
