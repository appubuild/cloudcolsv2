# Deployment — GitHub → Cloudflare Workers

Repository: `https://github.com/appubuild/cloud-cols`

CloudCols is **one Worker**. The public site, web app, developer portal, admin panel
and the API all ship together; `src/middleware.ts` routes `api.<domain>` to the API
handler and everything else to the web app.

---

## The two places called "Variables and secrets"

This is the single most confusing part of the Cloudflare dashboard, and it caused a
production outage on this project.

| Page | What it feeds | Reached from |
|------|---------------|--------------|
| **Workers Builds → Variables and secrets** | The **build process** only | Worker → Settings → Build |
| **Worker → Variables and secrets** | The **running Worker's bindings** | Worker → Settings (the Worker's own section) |

A value set in the first is **invisible** to the running Worker. The dashboard shows
it as configured, so nothing looks wrong, while every request behaves as though the
secret were missing.

**We no longer depend on getting that right.** `pnpm deploy` runs
`scripts/sync-secrets.mjs` before deploying, which copies any secret it finds in the
build environment into the Worker's real runtime secrets. Putting them in either place
now works.

---

## Configuration

### Public values — already committed, nothing to do

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are **not secrets**. The publishable key
is designed to ship in browser bundles and the URL appears in every network request.

They live in two committed places so both the build and the runtime always have them:

- `cloudcols-web/.env` — inlined by Next at build time
- `cloudcols-web/wrangler.jsonc` `vars` — available to the Worker at runtime

Treating these as secrets is what broke authentication: a fresh deploy had neither.

### Real secrets — three values

| Name | Where to find it |
|------|------------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → the `secret` key |
| `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Secret |
| `SECRETS_MASTER_KEY` | Generated once. Kept in `cloudcols-web/.dev.vars` |

Set them **either** way:

**A. In the dashboard** (either page — the sync step handles the rest)
Worker → Settings → Variables and secrets → Add → type **Secret**.

**B. From the CLI**
```bash
cd cloudcols-web
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put SECRETS_MASTER_KEY
```

> **`SECRETS_MASTER_KEY` cannot be regenerated.** It decrypts the B2 credentials stored
> in `app_secrets`. Lose it and those rows are unreadable and must be re-entered.

### Storage credentials

B2 credentials are read from the encrypted `app_secrets` table, so they do **not** need
to be Worker secrets. A binding still wins if one is set, which is useful as an
emergency override.

---

## Verifying a deployment

```
https://<worker-url>/health/ready
```

Answers on any host, so it works before a custom domain exists. It reports which
configuration groups are present — booleans only, never a value:

```json
{
  "ready": true,
  "environment": "production",
  "checks": {
    "supabaseUrl": true,
    "supabasePublishableKey": true,
    "supabaseServiceRoleKey": true,
    "secretsMasterKey": true,
    "storageBindings": false
  },
  "bindingsPresent": ["ENVIRONMENT", "LOG_LEVEL", "SUPABASE_URL", "..."]
}
```

- `storageBindings: false` is expected — B2 lives in the encrypted store.
- `bindingsPresent` lists the binding **names** the Worker actually received. A
  misspelled secret shows up here as an `unrecognisedBindings` entry, which is
  otherwise invisible.
- `environment` tells you which wrangler config was used. `"development"` means the
  deploy ran without `--env`, using the top-level config.

---

## Cloudflare Workers Builds settings

Worker → Settings → Build:

| Field | Value |
|-------|-------|
| Root directory | `/` |
| Build command | `pnpm run build` |
| Deploy command | `pnpm run deploy` |

`pnpm run deploy` builds the OpenNext bundle, syncs secrets, then deploys. It targets
the top-level config, so the Worker is named `cloudcols` and reports
`"environment": "development"`. To deploy the production environment instead, use
`pnpm --filter @cloudcols/web exec opennextjs-cloudflare deploy --env production`.

> **Trade-off:** this path deploys without running typecheck or tests. The GitHub
> Actions workflow runs both first and refuses to deploy on failure. Running both at
> once means two deploys per push; pick one.

### "Error fetching GitHub User or Organization details"

Cloudflare's GitHub App has lost access to the account. Reconnect it:
Worker → Settings → Build → **Manage** (or Disconnect, then reconnect the repository).
Deploys can keep working while this shows, but new commits may stop triggering builds.

---

## GitHub Actions

| Workflow | Trigger | Does |
|----------|---------|------|
| `ci.yml` | every push and PR to `main` | Typecheck, tests, design-token contrast suite, generated-output freshness, secret scan |
| `deploy.yml` | push to `main`, or manual | Typecheck + tests, then build and deploy |

Required repository secrets:

| Secret | How to get it |
|--------|---------------|
| `CLOUDFLARE_API_TOKEN` | My Profile → API Tokens → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages → Overview, right sidebar |

---

## Local development

```bash
pnpm dev        # http://localhost:3000
```

`cloudcols-web/.dev.vars` holds the secrets for local runs and is gitignored. Copy
`.dev.vars.example` and fill it in.

The OpenNext bundle **cannot be built on Windows** — it fails with `EPERM` creating
symlinks. `next build` and `next dev` work fine; only `opennextjs-cloudflare build`
is affected. Linux CI is unaffected, which is where deploys happen.

---

## Not yet configured

| Item | Blocked on |
|------|------------|
| Custom domain routes (`<domain>`, `api.<domain>`) | Domain not purchased. Commented out in `wrangler.jsonc`; the workers.dev subdomain works meanwhile. |
| SMTP for transactional email | Supabase's built-in mailer allows only a few messages per hour |
| Email confirmation | Currently off, so anyone can register with an address they do not own |
