---
name: product-planner
description: CloudCols master architecture and delivery plan (Architecture v2). Use when planning or implementing any CloudCols feature, choosing architecture, deciding scope or phase order, evaluating infrastructure/cost trade-offs, or determining whether work is complete. Covers the Next.js web app, Flutter mobile app, Cloudflare Workers API, Supabase, Backblaze B2, CDN delivery, Developer API, admin panel, and the phase plan.
---

# Product Planner Skill — CloudCols

## What this skill is

The master plan for CloudCols: a production-ready, multi-platform cloud storage and media SaaS.

This file has three layers, in order of authority:

| Layer | Content | Authority |
|-------|---------|-----------|
| §1–§6 | How to use this skill, invariants, gates | Current |
| **§7–§10** | **Architecture v2 — the current architecture, phase plan, and supersession table** | **Authoritative** |
| [§ Master Plan](#master-plan) | Original 71-section specification, preserved verbatim | **Product requirements only.** Its architecture and phase sections are superseded — see §10 |

> **Read §10 before trusting anything in the Master Plan section.** The Master Plan remains the
> authoritative source for *what the product does* (features, business rules, quotas, security
> requirements). Its *architecture, project structure, and phase* sections were written for a
> Flutter-everywhere design and are obsolete.

> **Provenance:** converted from `project_plan.md` 2026-08-28. Architecture v2 approved 2026-08-28
> following the Web/Flutter split decision.

---

## 1. When to use this skill

Load it when:

- Starting any CloudCols phase, feature, or module
- Making an architecture, infrastructure, storage, deployment, or cost decision
- Deciding what belongs in the current phase vs. a later one
- Deciding whether something belongs in `cloudcols-web`, `cloudcols-app`, or `cloudcols-api`
- Designing the data model, API surface, or service boundaries
- Judging whether a feature meets the Definition of Done

Route elsewhere for: visual values (`design/`), Next.js implementation (`web-engineer`), Flutter
implementation (`ui-engineer`), interaction QA (`product-experience`), security (`security-engineer`).

---

## 2. Skill dependencies

```
product-planner (this file) ─ scope, architecture, phases, Definition of Done
      │
      ├──▶ web-engineer        ─ Next.js + TypeScript implementation (cloudcols-web)
      │         │
      │         └──▶ design/*  ─ THE shared visual source of truth (all values)
      │                  ▲
      ├──▶ ui-engineer  ───┘    ─ Flutter implementation (cloudcols-app)
      │
      ├──▶ product-experience   ─ interaction behavior + QA process (both clients)
      │
      └──▶ security-engineer    ─ security gate; can block any release
```

**Precedence when skills conflict:**

1. `security-engineer` overrides everything.
2. `product-planner` (this file) defines *what* is built and *whether it is done*.
3. `design/` documents define every visual **value**, shared by both clients.
4. `web-engineer` / `ui-engineer` define *how* their platform implements it.
5. `product-experience` defines *how* interactions behave and how screens are QA'd.

---

## 3. Architecture invariants

Rules, not guidance. Everything else is negotiable.

| # | Invariant | Why |
|---|-----------|-----|
| 1 | **File bytes never transit our compute.** Upload: client → presigned URL → B2. Download: B2 → CDN → client. | Cloudflare request body limits are account-plan-bound (100 MB Free/Pro, 200 MB Business) — far below the 3 GB file limit. Routing a 3 GB file through a Worker is impossible, not merely expensive. |
| 2 | **Supabase Storage is not used for user files.** Postgres holds metadata; B2 holds objects. | Cost and egress. |
| 3 | **Authorization is server-side, always.** The client requests; the API decides. Quota, plan, entitlement, ownership never trusted from a client. | Multi-tenant isolation. |
| 4 | **Storage identity is an immutable internal user ID**, never the username. Object keys are server-generated and collision-resistant. | Usernames change; storage paths must not. |
| 5 | **The OpenAPI spec is the contract.** Both clients consume generated types. No hand-written API clients. | Two client codebases against one API drift within weeks otherwise. |
| 6 | **One design token source.** `design/tokens.json` generates both Dart and CSS. Neither client hand-writes a value. | Same reason. |
| 7 | **Every provider sits behind an abstraction** — storage, payment, email, auth. No B2 or Supabase specifics in UI or domain code. | Migration path off managed services. |
| 8 | **Nothing business-configurable is hardcoded** — prices, quotas, limits, retention, flags, ads come from the server. | Admin-panel control is a core requirement. |
| 9 | **The Developer API is a separate product** with its own plans, billing, limits, quotas. Never bundled with storage plans. | Business requirement. |
| 10 | **Developer/API management is Web-only.** It is never built into `cloudcols-app`. | Explicit product decision. |
| 11 | **No secrets in any client.** B2 keys, service-role keys, API signing secrets, payment secrets stay server-side. Web bundles and mobile binaries are both inspectable. | Non-negotiable. |
| 12 | **No premature infrastructure.** No Redis, no Elasticsearch, no transcoding cluster until real load justifies it. | Cost discipline. |
| 13 | **iOS-readiness maintained continuously.** No platform conditionals in shared Flutter logic. | iOS must be configuration, not rewrite. |
| 14 | **Verify provider facts against current official docs** before relying on them. Never assert a limit, price, or API shape from memory. | They change. This plan was revised twice already for exactly this reason. |

---

## 4. Verified platform facts

Checked 2026-08-28 against official sources. Re-verify before production lock-in.

| Fact | Implication |
|------|-------------|
| Cloudflare recommends **vinext** as the default Next.js-on-Workers path, but it is **in beta**. **`@opennextjs/cloudflare` reached 1.0 GA (April 2026)** and is the stable alternative. `@cloudflare/next-on-pages` is **deprecated**. | See §7.6 — we choose the GA adapter and treat vinext as the migration target. |
| Workers paid plan: **5 min CPU/request** (30 s default). Waiting on I/O does not count. | Ample for a metadata API. |
| **Request body size is capped by the Cloudflare account plan** (~100 MB Free/Pro, 200 MB Business), not the Workers plan. | Hard confirmation of invariant #1. Uploads must never traverse a Worker. |
| Workers subrequests: 10,000/invocation on paid (raised from 1,000 in Feb 2026), configurable higher. | Batch operations are viable. |
| **Cloudflare Media Transformations** can extract video frames (`frame` output) — but caps at **40 MB** and **h.264 MP4 only**. | Covers only a fraction of CloudCols video. Not a general thumbnail solution. See §7.7. |
| Workers cannot run ffmpeg or native binaries. | See §7.7 — this reverses part of the previous Node.js recommendation. |

---

## 5. Phase gate

No phase is complete until all pass, in addition to the per-feature Definition of Done (Master Plan §71).

- [ ] Formatter applied (`dart format` / `prettier`)
- [ ] Static analysis clean — `flutter analyze` / `tsc --noEmit` + `eslint`, zero warnings
- [ ] Unit + component/widget tests pass
- [ ] Affected targets build (`next build`, `flutter build apk`, Worker `wrangler deploy --dry-run`)
- [ ] Generated API clients regenerated and committed if the OpenAPI spec changed
- [ ] Design tokens regenerated if `design/tokens.json` changed
- [ ] Negative authorization tests pass — user A provably cannot reach user B's resources
- [ ] No secrets in any client bundle, the repository, or logs
- [ ] Loading, empty, error, offline states exist for every new surface
- [ ] Light and Dark verified for every new screen
- [ ] `security-engineer` review passed for anything touching auth, files, sharing, quota, payments, or the API
- [ ] Phase report delivered (§6 format)

**"Implementation complete" without evidence is not accepted.**

## 6. Reporting format

1. What was implemented · 2. Files/modules changed · 3. Tests performed and results · 4. Errors found ·
5. Errors fixed · 6. Remaining risks and known limitations · 7. Next phase

---

# 7. Architecture v2

## 7.1 Workspace layout

CloudCols is a parent workspace containing separately deployable applications.

```
cloudcols/                        parent workspace
├── cloudcols-web/                Next.js 16 + TypeScript
│   ├── public website (SSG)      marketing, pricing, blog
│   ├── user web app              file manager, preview, sharing
│   ├── developer portal          API dashboard, keys, webhooks, docs  [WEB-ONLY]
│   └── admin panel               all admin sections
│
├── cloudcols-app/                Flutter
│   ├── Android
│   ├── iOS
│   └── Desktop                   ON HOLD — see §9 Track F
│
├── cloudcols-api/                TypeScript on Cloudflare Workers
│   ├── internal API              consumed by web (service binding) + app (HTTPS)
│   ├── public Developer API      /v1, API-key authenticated
│   └── scheduled workers         cron: cleanup, aggregation, inactivity, webhook retry
│
├── packages/
│   ├── contracts/                OpenAPI spec + generated TS types  ← single source
│   ├── design-tokens/            tokens.json + generators (Dart + CSS)
│   └── shared-ts/                validation schemas, error codes, utils
│
├── design/                       shared visual source of truth (unchanged ownership)
├── infrastructure/               wrangler configs, Cloudflare, B2, Supabase migrations
├── docs/                         architecture, api, deployment, development
└── .claude/skills/               engineering skill system
```

Each of `cloudcols-web`, `cloudcols-app`, `cloudcols-api` is independently deployable and may become
its own repository. `packages/` is shared and versioned with the workspace.

## 7.2 Runtime topology

```
                    ┌──────────────────────────────────────┐
                    │            Cloudflare                │
   Browser ────────▶│  cloudcols.com                       │
                    │  ├─ Next.js Worker (SSG + SSR + BFF) │
                    │  │        │ service binding          │
                    │  │        ▼                          │
                    │  └─ API Worker ──────────────────────┼──▶ Supabase Postgres
   Flutter ────────▶│     api.cloudcols.com                │    (metadata, auth)
   (bearer JWT)     │        │                             │
                    │        │ presigned URLs only         │
   Developer ──────▶│        │                             │
   (API key)        │  cdn.cloudcols.com ──────────────────┼──▶ Backblaze B2
                    └──────────────────────────────────────┘    (file objects)
                             ▲                    ▲
                             │ download/preview   │ upload (direct, bypasses Cloudflare)
                             └────── client ──────┘
```

**Critical path detail:** uploads go **client → B2 S3 endpoint directly**, never through Cloudflare,
because of the account-plan request body cap (§4). Downloads and previews **do** go through
`cdn.cloudcols.com` for caching and Bandwidth Alliance egress terms.

## 7.3 The BFF pattern (browser never calls the API directly)

```
Browser ──same-origin──▶ Next.js route handler ──service binding──▶ API Worker
         httpOnly cookie                          zero-latency, no public hop

Flutter ──HTTPS bearer──▶ api.cloudcols.com (API Worker)

Developer ──HTTPS API key──▶ api.cloudcols.com/v1 (API Worker)
```

Why this shape:

- **No CORS** for the web app — every browser request is same-origin.
- **CSRF is contained** — `SameSite=Lax` httpOnly cookies plus same-origin, with a CSRF token on state-changing routes.
- **The session token never reaches browser JavaScript.** XSS cannot exfiltrate it.
- **Service bindings are Worker-to-Worker with no network hop**, so the extra layer costs effectively nothing.
- `api.cloudcols.com` stays a clean, public, bearer/API-key surface for Flutter and developers — exactly what the Developer API product needs.

## 7.4 Responsibility separation

| Concern | Owner | Notes |
|---------|-------|-------|
| Public website, SEO, OG tags, sitemap | `cloudcols-web` (SSG/SSR) | Flutter cannot do this at all |
| User web app | `cloudcols-web` | |
| Developer/API dashboard | `cloudcols-web` **only** | Invariant #10 |
| Admin panel | `cloudcols-web` **only** | |
| Android / iOS apps | `cloudcols-app` | |
| Business logic, authorization, quota | `cloudcols-api` | Single implementation, both clients |
| API contract | `packages/contracts` | OpenAPI → generated TS + Dart clients |
| Design values | `design/` + `packages/design-tokens` | One source, two outputs |
| Auth identity, JWT issuance | Supabase Auth | Behind an abstraction |
| Metadata, permissions, quotas, subscriptions | Supabase Postgres + RLS | |
| File objects, thumbnails | Backblaze B2 | S3-compatible API |
| CDN, caching, TLS, routing, WAF | Cloudflare | |
| Scheduled jobs | Worker Cron Triggers | cleanup, aggregation, inactivity, webhook retry |

## 7.5 Domain strategy

| Domain | Serves | Deployment |
|--------|--------|------------|
| `cloudcols.com` | Marketing (SSG), web app, admin, developer portal, share pages `/s/:token` | Next.js Worker |
| `api.cloudcols.com` | Public API — Flutter + Developer API `/v1` | API Worker |
| `cdn.cloudcols.com` | File download/preview delivery | Cloudflare → B2 |
| `staging.cloudcols.com` / `api-staging.cloudcols.com` | Staging | Separate Workers + Supabase branch |

Decisions embedded here:

- **Share links live at `cloudcols.com/s/:token`, not a subdomain** — server-rendered OG tags on the primary domain give correct social previews and inherit domain trust. This is the single biggest thing Flutter Web could not do.
- **Marketing and app share one origin.** Simpler cookies, one deployment, and route-level rendering strategy (SSG for marketing, SSR/CSR for app) is a Next.js strength.
- **API is a separate origin** because it is a product with third-party consumers; it needs independent versioning, rate limits, and CORS policy.

## 7.6 Next.js deployment adapter — decision required

| Option | Status | Trade-off |
|--------|--------|-----------|
| **`@opennextjs/cloudflare`** | **1.0 GA, April 2026** | Stable, Node.js runtime, full-featured. **Recommended for production.** |
| `vinext` | Cloudflare's stated default, **beta** | Newer, Cloudflare-native, but beta breakage on a production SaaS is expensive |
| `@cloudflare/next-on-pages` | **Deprecated** | Do not use |

**Recommendation: build on `@opennextjs/cloudflare` (GA), design for a vinext migration later.**
Keep adapter-specific code isolated so the swap is contained. This is decision **D2** in §11.

## 7.7 Thumbnail strategy — a reversal I need to flag

In the previous discussion I recommended a long-running Node.js backend partly because it can run
ffmpeg, solving the video-thumbnail blocker. **Moving to Cloudflare Workers reverses that** — Workers
cannot run ffmpeg or native binaries. The blocker returns.

Resolution:

| Tier | Approach | Scope |
|------|----------|-------|
| **MVP** | **Client-side generation at upload.** Web: `<video>` seek + `<canvas>` capture. Flutter: `video_thumbnail`. Thumbnail uploaded alongside the file. | All formats both clients can decode. Free, no server compute. |
| Enhancement | Cloudflare Media Transformations `frame` output | Only ≤40 MB h.264 MP4 (§4) — a minority of files |
| Deferred | Container-based ffmpeg worker | When real demand justifies the cost |

Consequence to accept: a file uploaded through the public Developer API has **no client to generate a
thumbnail**, so API-uploaded videos get a placeholder until the deferred tier exists. This is a real,
documented limitation — not an oversight.

## 7.8 Data and caching

- **Postgres via Supabase.** The API Worker is the only writer. RLS stays enabled as defense-in-depth, with the Worker connecting under a restricted role that propagates the caller identity — never a blanket service-role bypass (see `security-engineer`).
- **Cache layers:** browser → Cloudflare CDN (public/immutable only) → Workers KV (config, plans, feature flags, hot metadata) → Postgres.
- **Never cache authorization-sensitive responses at the CDN.** Private file responses are `private, no-store`; only thumbnails and public share assets are CDN-cacheable, keyed so no cross-tenant collision is possible.
- Rate limiting: Durable Objects for per-key/per-user counters; KV is not consistent enough for limits.

## 7.9 Session and auth model

| Client | Transport | CSRF |
|--------|-----------|------|
| Web | httpOnly `SameSite=Lax` cookie set by Next.js route handler | Token required on state-changing routes |
| Flutter | Bearer JWT in platform secure storage | N/A |
| Developer API | `Authorization: Bearer sk_live_…` API key, hashed at rest | N/A |

Supabase Auth issues the JWT. The API Worker verifies it. Two transports, one identity model.

---

# 8. What is deferred

| Item | Status | Revisit when |
|------|--------|--------------|
| **Flutter Desktop** (Windows/macOS/Linux) | **ON HOLD** | Superseded by the Web desktop-wrapper path (Track F). Environment also blocks it — no Visual Studio C++, no Mac. |
| **Desktop wrapper** (Electron/Tauri around `cloudcols-web`) | Track F, post-launch | After web app is stable |
| Server-side video transcoding / ffmpeg | Deferred | Real demand + budget |
| Redis, Elasticsearch | Deferred | Invariant #12 |
| iOS release | Track E, needs a Mac | Hardware acquired |

**Desktop-wrapper readiness rules** (must hold from Phase 3 onward, cheap now, expensive to retrofit):

- No hard dependency on `window.location.origin` being a public URL
- All API access through one configurable base URL / binding layer
- Filesystem interactions abstracted (`downloadFile()`, not direct DOM anchor hacks)
- No reliance on third-party cookies
- Auth flow works in a webview-hosted context
- Keyboard shortcuts registered through one manager, so native menus can bind later

---

# 9. Phase plan

Six tracks. Tracks B→C are sequential; **Track D can run in parallel with Track C once Phase 2 ships.**

### Track A — Foundation

**Phase 0 · Contracts & scaffolding** *(no application code)*
Workspace + `git init` · OpenAPI v1 spec · `design/tokens.json` + generators · Supabase schema and RLS
migrations · environment/secrets strategy · `docs/architecture/ARCHITECTURE.md`, `ROADMAP.md`,
`SETUP.md` · ADRs for the decisions in §11.

### Track B — Backend

**Phase 1 · API core** — Worker skeleton (Hono), Supabase JWT verification, Postgres access layer,
error model + machine-readable codes, structured logging, rate limiting via Durable Objects, health
checks, staging deploy to `api-staging.cloudcols.com`.

**Phase 2 · Storage core** — B2 S3-compatible integration behind `StorageService`; presigned
multipart upload issuance; presigned download/preview issuance; server-side object verification on
commit; atomic quota accounting; object key generation; category classification.
*Track D unblocks here.*

### Track C — Web

**Phase 3 · Web foundation** — Next.js 16 + TS on the chosen adapter; token consumption; app shell,
routing, theming; auth pages; cookie session + CSRF; BFF route handlers + service binding.

**Phase 4 · Web file manager** — list/grid/table, folders, breadcrumbs, direct-to-B2 resumable
upload, download, rename/move/copy, trash, favorites, recent, search, drag & drop, keyboard shortcuts.

**Phase 5 · Web media** — image viewer, video player with range requests, PDF viewer, audio player,
client-side thumbnail generation.

**Phase 6 · Sharing, public site, SEO** — share links + revocation; **SSR public share page with OG
tags**; marketing and pricing (SSG); sitemap, robots, structured data.

**Phase 7 · Monetization** — server-driven plans, subscription architecture, payment abstraction,
ads configuration, quota enforcement.

**Phase 8 · Developer API + portal** *(web-only)* — API keys, scopes, per-key rate limits, usage
analytics, webhooks with retry, `/v1` public surface, SSG documentation with code tabs.

**Phase 9 · Admin panel** — all sections from Master Plan §25, server-side role gate, audit logging.

### Track D — Flutter *(parallel with Track C after Phase 2)*

**Phase 10 · App foundation** — Flutter project, generated Dart API client, generated Dart tokens,
routing, state management, auth, secure token storage.

**Phase 11 · App file manager** — file browsing, direct-to-B2 upload with background transfer,
download, file operations, search, trash, favorites.

**Phase 12 · App media & account** — image/video/audio/PDF preview, sharing, storage dashboard, plans,
profile, settings, notifications. **No developer/API surfaces** (invariant #10).

### Track E — Release

**Phase 13 · Hardening** — full security review, performance, caching, observability, cost monitoring.
**Phase 14 · Android release** — signing, Play Store assets, Data Safety, target-API verification.
**Phase 15 · iOS release** — requires a Mac.

### Track F — Deferred

**Phase 16 · Desktop wrapper** — package `cloudcols-web` via Electron or Tauri; native menus, OS file
integration, auto-update, code signing.

---

# 10. Supersession table — what in the Master Plan is now obsolete

The Master Plan below remains authoritative for **product requirements**. These specific sections are
**superseded** and must not be followed as written.

| Master Plan section | Status | Replaced by |
|---------------------|--------|-------------|
| §1 "primary client framework must be Flutter/Dart" (Web) | **Obsolete for web** | §7.1 — Next.js owns web; Flutter owns mobile |
| §2 Supabase as application/API layer | **Superseded** | §7.2 — Cloudflare Workers is the API layer; Supabase is DB + Auth |
| §12–13 preview/thumbnail assumptions | **Amended** | §7.7 — client-side generation; server-side deferred |
| §14 cache architecture | **Amended** | §7.8 — CDN + Workers KV + Postgres |
| §28 UI/UX main navigation | **Amended** | `design/MOBILE_UI.md` (5-tab mobile IA), `design/WEB_DESKTOP_UI.md` (web shell) |
| §29 Responsive Web (Flutter Web) | **Obsolete** | §7.1 — Next.js, real DOM, SSR |
| §31 iOS-ready architecture | **Retained**, scope narrowed to `cloudcols-app` | — |
| §32 Desktop (Flutter Windows/macOS) | **ON HOLD** | §8 — Track F web wrapper |
| §33 Flutter architecture | **Retained** for `cloudcols-app` only | — |
| §45 background jobs | **Amended** | §7.2 — Worker Cron Triggers |
| §48 project structure | **Obsolete** | §7.1 workspace layout |
| §51 development phases (0–15) | **Obsolete** | §9 phase plan |
| §67 final deliverables | **Amended** | Desktop build config removed; web build config added |

Everything else — accounts, identity, naming, upload rules, quotas, inactivity policy, file manager
features, categorization, sharing, downloads, Developer API product design, API security, rate
limiting, admin panel, monetization, ads, security, logging, error handling, search, duplicates,
trash, email, docs, environment management, testing, build quality, performance, privacy,
accessibility, i18n, branding, backups, scaling — **remains fully in force.**

---

# 11. Decisions requiring approval

| # | Decision | Recommendation |
|---|----------|----------------|
| **D1** | Confirm Architecture v2 | — |
| **D2** | Next.js adapter: OpenNext (GA) vs vinext (beta) | **OpenNext**, migrate to vinext at GA |
| **D3** | API framework on Workers: Hono / itty-router / raw | **Hono** — mature, typed, OpenAPI integration |
| **D4** | Accept the API-upload thumbnail gap (§7.7) until the deferred tier | Accept |
| **D5** | Cloudflare plan: Free vs Pro vs Business | Start Free; Business only if body-size limits ever matter (they should not, per invariant #1) |
| **D6** | Repos: one workspace repo vs three | **One workspace repo now**, split later if needed |
| **D7** | Track D parallel with Track C, or sequential after Phase 9 | Sequential is realistic for a solo developer |

---

<a id="master-plan"></a>
# Master Plan

*Preserved verbatim from the original `project_plan.md`. **Product requirements are authoritative;
architecture, project-structure, and phase sections are superseded — see §10.***

You are the Lead Product Architect, Senior Flutter Engineer, Backend Engineer, Cloud Infrastructure Engineer, Security Engineer, DevOps Engineer, UI/UX Designer, QA Engineer, and Technical Project Manager for this project.

Your job is to DESIGN, BUILD, TEST, DEBUG, DOCUMENT, and DELIVER a production-ready multi-platform cloud storage and media platform.

Do not treat this as a simple demo or UI prototype.

Build it as a scalable SaaS product that can start cheaply with managed services and later migrate to dedicated infrastructure without requiring a major rewrite.

============================================================
1. PRODUCT VISION
============================================================

Build a modern cloud storage platform similar in concept to services such as TeraBox/Google Drive/Dropbox, but with our own branding, UI, architecture, business model, storage system, media preview system, sharing system, and Developer API platform.

The product must support:

- Web application
- Android application
- Desktop application
- iOS-ready architecture for future release

The primary client framework must be Flutter/Dart so that the maximum amount of application code can be shared across:

- Android
- iOS
- Web
- Windows
- macOS
- Linux where practical

Do not create completely separate application implementations for each platform unless platform-specific APIs are required.

The architecture must be modular and platform-independent.

============================================================
2. CORE INFRASTRUCTURE STRATEGY
============================================================

Use this initial architecture:

CLIENTS
    ↓
Flutter Application
    ↓
Application/API Layer
    ↓
Supabase
    - Authentication
    - PostgreSQL metadata
    - application data
    - permissions
    - subscriptions
    - quotas
    - developer API configuration
    ↓
Backblaze B2
    - actual user files
    - images
    - videos
    - PDFs
    - documents
    - audio
    - archives
    - other files
    ↓
Cloudflare
    - CDN
    - caching
    - secure delivery
    - domain/routing layer where appropriate

IMPORTANT:

Supabase Storage must NOT be used for the primary user file storage.

Actual large files must live in Backblaze B2.

Supabase PostgreSQL stores metadata and application state, not large binary files.

The application server/API must NEVER unnecessarily proxy large files.

A 1GB, 2GB, or 3GB file must not travel:

User → Application Server → B2 → Application Server → User

Instead use:

User → authorized upload → B2

and:

User → API permission check → signed/authorized URL → Cloudflare/B2 → User

The application server should handle metadata, authentication, authorization, quotas, signing, and business logic.

It should not become a large-file bandwidth proxy.

============================================================
3. COST OPTIMIZATION PRINCIPLE
============================================================

The initial architecture must be optimized for minimum infrastructure cost.

The business goal is NOT to incorrectly assume that everything is permanently free.

Instead:

- Use free tiers where appropriate.
- Use B2 pay-as-you-use storage.
- Use Cloudflare/CDN delivery appropriately.
- Avoid unnecessary bandwidth through our application server.
- Avoid storing duplicate large files.
- Avoid unnecessary database requests.
- Use browser/app cache where safe.
- Use CDN cache where safe.
- Cache frequently requested metadata.
- Avoid unnecessary background processing.
- Avoid paid infrastructure until actual scale requires it.

The architecture must have clear upgrade paths when free quotas are exceeded.

Do not build the system around assumptions of unlimited free usage.

Always verify current provider pricing, limits, API rules, Cloudflare/B2 integration rules, Flutter requirements, Android requirements, iOS requirements, and Play Store policies against official documentation before production deployment.

============================================================
4. USER ACCOUNT SYSTEM
============================================================

Implement:

- Registration
- Login
- Logout
- Email verification
- Password reset
- Session management
- Profile
- Unique username
- Display name
- Avatar
- Account status
- Storage quota
- Storage usage
- Subscription status
- Account creation date
- Last active date
- Developer/API status

Use Supabase Auth initially.

Do not tightly couple the Flutter frontend to Supabase implementation details.

Create an application/service abstraction so authentication can later be migrated if required.

============================================================
5. USER IDENTITY AND STORAGE PATH
============================================================

Do NOT make username the permanent internal storage identity.

Use an immutable internal user ID as the real storage identity.

Username is only a public/display identity and must be unique.

Example logical structure:

users/
    USER_ID/
        images/
        videos/
        documents/
        pdf/
        audio/
        archives/
        others/

Do not physically create thousands of empty folders in B2.

B2 object prefixes should create the logical folder structure only when an object exists.

Example:

users/USER_ID/images/CloudDrive_20260827_160215_RANDOM.jpg

============================================================
6. FILE NAMING SYSTEM
============================================================

When a user uploads:

"My Holiday Photo 2026.jpg"

The UI must preserve and display the original filename.

The storage object should use a generated unique server-side filename.

Example:

CloudDrive_20260827_160215_RANDOM.jpg

or another secure collision-resistant naming scheme.

Do NOT rely only on timestamps.

Use timestamp + random/UUID-based uniqueness.

Store metadata that maps:

- original filename
- storage object key
- extension
- MIME type
- size
- owner
- folder
- upload timestamp
- status
- preview information where applicable

Do not expose sensitive storage credentials.

============================================================
7. FILE UPLOAD SYSTEM
============================================================

Maximum individual file size initially:

3 GB

Make this configurable from the admin panel.

The upload system must support:

- Large files
- Multipart/resumable upload
- Pause/resume where supported
- Retry failed parts
- Progress percentage
- Upload speed
- Estimated remaining time
- Cancel upload
- Retry upload
- Upload queue
- Multiple file upload
- Folder upload where supported
- Duplicate filename handling
- Network interruption recovery
- File type validation
- Storage quota validation
- Maximum file size validation

Never upload large files through the application server unnecessarily.

Use secure authorized upload URLs/credentials.

Never expose permanent B2 application secrets to Flutter.

============================================================
8. STORAGE QUOTA SYSTEM
============================================================

Implement configurable storage plans.

Initial conceptual plans:

FREE
- Example: 20 GB
- Ads enabled
- Basic features

PRO 100 GB
- 100 GB
- No ads

PRO 200 GB
- 200 GB
- No ads

PRO 1 TB
- 1 TB
- No ads

The exact pricing must be configurable through the Admin Panel.

Do not hard-code prices throughout the application.

The system must calculate:

- allocated storage
- used storage
- remaining storage
- reserved upload space if needed
- file count
- quota percentage

Prevent uploads when quota is exceeded.

Use server-side enforcement.

Never trust quota values supplied by the client.

============================================================
9. ACCOUNT INACTIVITY POLICY
============================================================

Implement an administrator-configurable inactivity policy.

Example:

If a user has been inactive for a defined period:

1. Warning
2. Final warning
3. Grace period
4. Account/file deletion according to configured policy

Do NOT immediately delete accounts without a warning workflow.

Create configurable settings for:

- inactivity duration
- warning duration
- final warning duration
- deletion grace period

All automated deletion actions must be logged.

Do not delete files merely because the client claims the user is inactive.

The backend must enforce this.

============================================================
10. FILE MANAGER
============================================================

The main application must feel like a professional cloud file manager.

Features:

- All Files
- Recent
- Favorites
- Trash
- Shared
- Images
- Videos
- Documents
- PDFs
- Audio
- Archives
- Other files
- User-created folders

Support:

- Create folder
- Rename
- Move
- Copy
- Delete
- Restore
- Permanent delete
- Favorite
- Unfavorite
- Search
- Sort
- Filter
- Grid view
- List view
- Multi-select
- Bulk delete
- Bulk move
- Bulk download where practical
- Share
- Copy link
- File details

============================================================
11. AUTOMATIC FILE CATEGORIZATION
============================================================

When uploading a file, determine its category using MIME type and extension.

Examples:

image/*
→ Images

video/*
→ Videos

audio/*
→ Audio

application/pdf
→ PDF

documents
→ Documents

archives
→ Archives

unknown/unsupported
→ Others

The classification must be backend-authoritative.

Do not trust only the filename extension.

============================================================
12. FILE PREVIEW SYSTEM
============================================================

Build a unified preview system.

Support as many safe/common formats as practical:

Images:
- JPG
- JPEG
- PNG
- WEBP
- GIF where appropriate
- SVG where safe

Video:
- MP4
- WebM
- common browser-supported formats

Audio:
- MP3
- WAV
- common supported formats

PDF:
- PDF preview

Documents:
- preview when browser/platform support is practical
- otherwise download/open externally

Create a reusable Flutter Preview component.

Video playback must support:

- Play/pause
- Seek
- Fullscreen
- Volume
- Progress
- Resume where practical

For large media, use streaming-friendly delivery.

Do not force every video through our application server.

============================================================
13. THUMBNAIL SYSTEM
============================================================

Generate thumbnails where appropriate.

Thumbnails should be stored in B2 or another appropriate object-storage location.

Do not regenerate the same thumbnail repeatedly.

Use deterministic thumbnail naming or metadata mapping.

Use CDN caching for thumbnails where safe.

Do not create unnecessary thumbnails for file types that do not need them.

============================================================
14. CACHE ARCHITECTURE
============================================================

Implement multi-layer caching.

Layer 1:
Browser/Flutter local cache

Layer 2:
CDN cache

Layer 3:
Application-level cache where appropriate

Layer 4:
Database

Frequently accessed data should not hit PostgreSQL unnecessarily.

Examples:

- User profile
- Plan configuration
- Folder metadata
- File listing
- Public/share metadata
- Developer API configuration
- System settings

Cache must have:

- TTL
- invalidation strategy
- cache key strategy

Do NOT cache private data in a way that can expose User A's content to User B.

Private files require secure authorization.

Do not cache authorization decisions forever.

When a file is renamed/deleted/moved, invalidate relevant metadata cache.

When permissions change, invalidate relevant access cache.

============================================================
15. CLOUDFLARE + B2 DELIVERY
============================================================

Use Backblaze B2 as the primary object storage.

Use Cloudflare as the delivery/CDN layer where appropriate.

The architecture must support:

- CDN caching
- browser caching
- cache-control
- range requests for media where supported
- secure/private file access
- signed/temporary access URLs
- cache invalidation where necessary

Do not expose the B2 secret key to clients.

Do not make all private files permanently public.

Use secure access mechanisms.

Before final production configuration, verify the current official Backblaze and Cloudflare documentation for:

- B2 pricing
- egress rules
- Bandwidth Alliance rules
- CDN integration
- cache behavior
- request limitations
- private content delivery
- signed URL capabilities
- domain configuration

Do not claim something is free unless current provider documentation confirms it.

============================================================
16. SHARING SYSTEM
============================================================

Implement secure file/folder sharing.

Features:

- Generate share link
- Disable share link
- Expiration
- Optional password
- View/download permissions
- Share folder
- Share file
- Public/private setting
- Access count
- Share analytics
- Revoke access

Never expose internal database IDs unnecessarily.

Use secure public share tokens.

Share links must not automatically grant access to unrelated user files.

============================================================
17. DOWNLOAD SYSTEM
============================================================

Downloads should preferably use direct authorized delivery.

Flow:

User
 ↓
Application API
 ↓
Authentication
 ↓
Permission check
 ↓
Generate authorized URL
 ↓
Cloudflare/B2
 ↓
User

Do not proxy large downloads through our application server.

Support:

- Single file download
- Folder download where practical
- Download progress
- Retry
- Resume where platform supports it

For huge folder downloads, design an asynchronous archive workflow only if necessary.

Do not create archives synchronously inside a normal API request.

============================================================
18. DEVELOPER API PRODUCT
============================================================

IMPORTANT:

The Developer API is a completely separate commercial product.

It is NOT automatically bundled with storage plans.

Storage subscription:

- 100 GB
- 200 GB
- 1 TB
- etc.

Developer API subscription:

- Separate plans
- Separate billing
- Separate limits
- Separate rate limits
- Separate request quotas
- Separate usage analytics

The exact pricing must be configurable through Admin.

============================================================
19. DEVELOPER API BASE URL
============================================================

Use one common API base URL.

Conceptual:

https://api.YOURDOMAIN.com/v1

All developers use the same base URL.

Each developer receives separate credentials.

Example:

API Key A → User A

API Key B → User B

API Key C → User C

The API key must identify and authorize the developer account.

Never trust a client-provided user_id to determine ownership.

Ownership must be derived from the authenticated API credential.

============================================================
20. DEVELOPER API FEATURES
============================================================

Design REST API endpoints for:

Authentication
API key management
Files
Folders
Search
Upload
Download URL generation
Preview URL generation
File metadata
Folder listing
File filtering
Sharing
Webhooks
Usage
Rate limits

Conceptual endpoints:

GET /v1/files
GET /v1/files/:id
GET /v1/folders
GET /v1/folders/:id
GET /v1/files?type=image
GET /v1/files?type=video
GET /v1/files?folder=...
GET /v1/files?search=...
POST /v1/files/upload
DELETE /v1/files/:id
POST /v1/files/:id/share
GET /v1/files/:id/download-url

Exact endpoint naming can be improved if a better REST design is identified.

The API must be versioned.

Use:

/v1

Do not break v1 when v2 is introduced.

============================================================
21. API SECURITY
============================================================

API keys must be:

- Securely generated
- Hashed where appropriate
- Revocable
- Rotatable
- Expirable where appropriate
- Scope-based where appropriate

Never expose raw secrets in logs.

Support scopes such as:

- files.read
- files.write
- files.delete
- folders.read
- folders.write
- share.create
- webhook.manage

Use least privilege.

Implement:

- Authentication
- Authorization
- Rate limiting
- Request validation
- Abuse prevention
- API logging
- Error handling

============================================================
22. API RATE LIMITING
============================================================

API limits must be configurable by plan.

Example:

Developer Free/Trial:
- X requests/minute
- X requests/day

Developer:
- higher limits

Business:
- higher limits

Enterprise:
- custom limits

Do not hard-code these values.

Admin must be able to configure:

- requests/minute
- requests/hour
- requests/day
- monthly request quota
- upload limit
- download URL generation limit
- webhook limit

Return proper HTTP status codes such as 429 for rate-limit violations.

============================================================
23. API USAGE DASHBOARD
============================================================

Developer dashboard must show:

- API requests
- Successful requests
- Failed requests
- 4xx errors
- 5xx errors
- rate-limit events
- bandwidth/usage where measurable
- current plan
- remaining quota
- API keys
- recent API activity

Charts should be lightweight and not create excessive database load.

Use aggregated statistics where appropriate.

============================================================
24. WEBHOOK SYSTEM
============================================================

Support developer webhooks for events such as:

file.created
file.updated
file.deleted
file.moved
file.shared
folder.created
folder.deleted

Webhook system must support:

- URL
- secret/signature
- event selection
- enable/disable
- retries
- delivery logs

Do not block normal file uploads while waiting for a webhook endpoint.

Use asynchronous processing.

============================================================
25. ADMIN PANEL
============================================================

Create a complete responsive Admin Panel.

Sections:

Dashboard
Users
Storage
Files
Plans
Subscriptions
Payments
Ads
Developer API
API Plans
API Usage
API Keys
Webhooks
Sharing
System Settings
Security
Notifications
Email Templates
Activity Logs
Reports
Maintenance
Feature Flags

Admin dashboard should display:

- Total users
- Active users
- New users
- Storage used
- Storage remaining
- Total files
- Upload volume
- Download activity
- Free users
- Pro users
- API customers
- API usage
- Revenue metrics
- Storage cost estimates where possible
- System health

============================================================
26. MONETIZATION
============================================================

Implement configurable monetization.

Free users:

- limited storage
- ads
- basic functionality

Pro users:

- higher storage
- no ads
- premium functionality

Developer API:

- completely separate subscription
- separate pricing
- separate usage limits

Do not hard-code pricing.

Admin should control:

- plan name
- storage quota
- price
- billing period
- API limits
- feature availability
- ads enabled/disabled
- status

Payment integration must be modular.

Do not tightly couple the entire application to one payment provider.

============================================================
27. ADS
============================================================

Ads should be enabled only where configured.

Free users may see ads.

Pro users should not see ads.

Never show ads in a way that interferes with:

- file upload
- file download
- privacy
- security
- core navigation

Create an ad configuration system.

Do not hard-code ad provider IDs throughout the application.

============================================================
28. UI/UX DESIGN
============================================================

Create a premium modern cloud-storage UI.

Design goals:

- Clean
- Fast
- Minimal
- Professional
- Responsive
- Mobile-first
- Desktop-friendly
- Accessible
- Dark mode
- Light mode

Main navigation:

Dashboard
My Files
Recent
Images
Videos
Documents
PDF
Audio
Favorites
Shared
Trash
Storage
Developer/API
Settings

Desktop:
- Sidebar navigation
- Top bar
- Search
- Upload button
- User profile
- Storage indicator

Mobile:
- Bottom navigation where appropriate
- Floating/action upload button
- Responsive file browser
- Touch-friendly controls

File cards should display:

- thumbnail/icon
- original filename
- type
- size
- modified date
- actions

Provide:

- Grid view
- List view

============================================================
29. RESPONSIVE WEB
============================================================

The Flutter web application must work well on:

- desktop
- laptop
- tablet
- mobile browser

Do not simply stretch desktop UI onto mobile.

Use responsive breakpoints.

============================================================
30. ANDROID
============================================================

Build a proper Flutter Android application.

Support:

- login
- file browsing
- upload
- download
- preview
- video playback
- image gallery
- PDF preview
- sharing
- notifications where required
- background upload/download where platform APIs allow
- permission handling
- network failure handling

Before Play Store release, verify current Google Play requirements and target API requirements from official Android/Google documentation.

Do not guess current Play Store policy requirements.

============================================================
31. IOS-READY ARCHITECTURE
============================================================

The codebase must be designed so that iOS can be added later with minimal architectural changes.

Avoid Android-only assumptions in shared business logic.

Use platform abstraction for:

- file picker
- storage
- notifications
- background tasks
- permissions
- downloads
- media playback

============================================================
32. DESKTOP
============================================================

Support desktop file workflows.

At minimum:

- Windows
- macOS

Linux can be supported where practical.

Desktop should support:

- drag & drop
- file picker
- upload queue
- download
- file preview
- keyboard shortcuts where practical

============================================================
33. FLUTTER ARCHITECTURE
============================================================

Use a scalable Flutter architecture.

Prefer a clean separation such as:

Presentation
↓
Application
↓
Domain
↓
Data
↓
Infrastructure

Use a consistent state management solution.

Choose a mature solution such as Riverpod, Bloc, or another well-supported architecture.

Do not introduce unnecessary dependencies.

Use repository/service abstractions.

Example conceptual modules:

AuthRepository
FileRepository
FolderRepository
StorageService
UploadService
DownloadService
PreviewService
ShareService
SubscriptionService
DeveloperApiService
CacheService

============================================================
34. STORAGE ABSTRACTION
============================================================

Create a storage abstraction.

Conceptually:

StorageService

Methods should cover:

- upload
- multipart upload
- resume upload
- delete
- copy
- move
- create authorized URL
- metadata
- existence check

Initial implementation:

Backblaze B2

Future implementations could include:

- S3
- Cloudflare R2
- Wasabi
- MinIO
- other S3-compatible providers

The frontend must not know provider-specific credentials.

============================================================
35. DATABASE ABSTRACTION
============================================================

Initially use Supabase PostgreSQL.

However, the application architecture must not make future database migration unnecessarily difficult.

Use repository/service boundaries.

Today:

Repository → Supabase PostgreSQL

Future:

Repository → Dedicated PostgreSQL

or:

Repository → Managed PostgreSQL

Do not hard-code Supabase-specific queries throughout every Flutter screen.

============================================================
36. IMPORTANT DATABASE INSTRUCTION
============================================================

Do NOT unnecessarily produce a huge database schema inside the project documentation or this development prompt.

Create the required database, tables, indexes, relationships, security policies, and migrations as required by the implementation.

Keep database implementation organized and documented in the codebase.

The architecture should focus on functionality and maintainability rather than filling documentation with excessive schema definitions.

============================================================
37. SECURITY
============================================================

Security is a first-class requirement.

Implement:

- authentication
- authorization
- ownership checks
- server-side quota validation
- signed/temporary file URLs
- secure API keys
- rate limiting
- input validation
- MIME validation
- file size validation
- path traversal prevention
- secure CORS configuration
- CSRF protection where relevant
- secure headers
- secret management
- audit logs
- error sanitization

Never expose:

- B2 secret keys
- database passwords
- Supabase service-role keys
- private server secrets
- API secrets

to client applications.

============================================================
38. FILE ACCESS SECURITY
============================================================

Every private file access must verify:

- authenticated user
- file ownership or permission
- file status
- share permission if shared
- expiration where applicable

Never trust:

- user_id
- folder_id
- file_id
- username

provided by a client without authorization validation.

Prevent IDOR vulnerabilities.

============================================================
39. RATE LIMITING AND ABUSE PROTECTION
============================================================

Protect:

- login
- registration
- password reset
- file metadata API
- upload creation
- download URL generation
- sharing
- developer API
- webhook endpoints

Rate limits should be configurable.

Use the simplest reliable implementation initially.

Do not introduce Redis just because it sounds scalable.

Introduce Redis only when actual requirements justify it.

============================================================
40. LOGGING
============================================================

Create structured logging.

Log:

- authentication events
- uploads
- deletes
- shares
- API requests
- rate-limit violations
- admin actions
- system errors

Do not log:

- passwords
- raw API secrets
- B2 secrets
- private access tokens

============================================================
41. ERROR HANDLING
============================================================

Create consistent error responses.

Frontend should show human-readable errors.

Backend should return machine-readable error codes.

Example:

FILE_TOO_LARGE
QUOTA_EXCEEDED
UNAUTHORIZED
FORBIDDEN
FILE_NOT_FOUND
RATE_LIMITED
UPLOAD_FAILED
INVALID_FILE_TYPE
SHARE_EXPIRED

Do not expose stack traces in production.

============================================================
42. SEARCH
============================================================

Implement file search.

Search by:

- filename
- file type
- folder
- date
- size
- favorite
- shared status

Start with PostgreSQL search capabilities.

Do not introduce Elasticsearch/OpenSearch unless actual scale requires it.

============================================================
43. DUPLICATE FILE STRATEGY
============================================================

Design a future-ready duplicate detection system.

Potentially use:

- file hash
- size
- MIME
- owner

Do not automatically deduplicate across different users unless privacy and ownership rules are explicitly designed.

For the first version, user-level duplicate detection is sufficient.

============================================================
44. TRASH SYSTEM
============================================================

Deleted files should initially go to Trash.

Features:

- Restore
- Permanent delete
- Empty trash
- configurable retention period

Trash storage must still count toward quota unless the business rules explicitly state otherwise.

Make this behavior configurable.

Automatic cleanup should be handled by background jobs.

============================================================
45. BACKGROUND JOBS
============================================================

Use asynchronous jobs for tasks such as:

- thumbnail generation
- cleanup
- inactive account warnings
- trash cleanup
- webhook delivery
- usage aggregation
- email notifications

Do not perform heavy work inside synchronous API requests.

Keep the initial job system simple.

Use scheduled functions/cron/background workers where appropriate.

============================================================
46. EMAIL SYSTEM
============================================================

Implement transactional email abstraction.

Examples:

- welcome
- email verification
- password reset
- inactivity warning
- final warning
- subscription confirmation
- API key creation
- security notification

Email templates must be configurable from Admin.

Do not hard-code email content inside business logic.

============================================================
47. API DOCUMENTATION
============================================================

Create developer documentation.

Include:

- Authentication
- API keys
- Base URL
- File API
- Folder API
- Upload API
- Download URL
- Preview URL
- Sharing
- Webhooks
- Rate limits
- Error codes
- Examples

Use OpenAPI/Swagger where appropriate.

Developer documentation should be accessible from the Developer Portal.

============================================================
48. PROJECT STRUCTURE
============================================================

Create a clean monorepo or modular repository structure.

Prefer something conceptually similar to:

/apps
    /flutter_app

/backend
    /api

/functions
    /supabase

/packages
    /shared_models
    /shared_utils
    /api_client

/infrastructure
    /deployment
    /cloudflare
    /storage

/docs
    /architecture
    /api
    /deployment
    /development

/scripts

/tests

Adjust the exact structure if a better Flutter/Dart architecture is identified.

Do not create meaningless folders just to make the repository look large.

Every folder must have a clear responsibility.

============================================================
49. ENVIRONMENT MANAGEMENT
============================================================

Create:

.env.example

Never commit secrets.

Separate:

Development
Staging
Production

configuration.

Use environment variables for:

- API base URL
- Supabase URL
- Supabase public key
- storage configuration
- Cloudflare configuration
- payment configuration
- email configuration
- analytics configuration

Server-only secrets must never enter Flutter builds.

============================================================
50. DEVELOPMENT ENVIRONMENT
============================================================

The project must be easy to develop from:

- VS Code
- Android Studio
- Flutter CLI

Provide:

- setup documentation
- required SDK versions
- installation commands
- environment setup
- database setup
- B2 setup
- Cloudflare setup
- local development
- testing
- build commands

============================================================
51. DEVELOPMENT PHASES
============================================================

Do NOT attempt to implement the entire system in one uncontrolled generation.

Follow these phases.

PHASE 0 — ARCHITECTURE

Before writing major code:

- inspect repository
- identify existing code
- propose architecture
- identify dependencies
- identify risks
- identify provider limitations
- verify current official documentation
- create implementation roadmap

If an existing repository is provided, do not destroy working code without reason.

PHASE 1 — PROJECT FOUNDATION

Implement:

- Flutter project
- responsive architecture
- theme
- routing
- state management
- service/repository structure
- environment handling
- error handling
- logging

PHASE 2 — AUTHENTICATION

Implement:

- registration
- login
- verification
- password reset
- profile
- username
- session handling

PHASE 3 — STORAGE CORE

Implement:

- B2 integration
- storage abstraction
- authorized uploads
- multipart/resumable uploads
- file metadata
- quotas
- categories
- object naming
- folder logic

PHASE 4 — FILE MANAGER

Implement:

- dashboard
- folders
- grid/list
- search
- sorting
- filtering
- rename
- move
- copy
- delete
- trash
- favorites
- recent files

PHASE 5 — MEDIA

Implement:

- image preview
- video playback
- PDF preview
- audio playback
- thumbnails
- CDN delivery
- cache strategy

PHASE 6 — SHARING

Implement:

- share links
- permissions
- expiration
- password where applicable
- revoke
- public share page

PHASE 7 — MONETIZATION

Implement:

- storage plans
- subscription architecture
- free/pro features
- ads
- quota enforcement

PHASE 8 — DEVELOPER API

Implement:

- Developer Portal
- API keys
- scopes
- REST API
- file listing
- filters
- upload
- download URLs
- preview URLs
- rate limits
- usage analytics
- webhooks
- API documentation

PHASE 9 — ADMIN

Implement complete Admin Panel.

PHASE 10 — OPTIMIZATION

Implement:

- caching
- lazy loading
- pagination
- database optimization
- CDN optimization
- upload optimization
- memory optimization
- mobile performance
- desktop performance

PHASE 11 — SECURITY

Perform security review.

Check:

- authorization
- IDOR
- API keys
- file access
- signed URLs
- CORS
- rate limits
- secret exposure
- path traversal
- upload validation

PHASE 12 — TESTING

Create:

- unit tests
- widget tests
- integration tests
- API tests
- upload tests
- authorization tests
- rate limit tests
- sharing tests
- quota tests

PHASE 13 — DEPLOYMENT

Create:

- production build
- deployment documentation
- environment documentation
- B2 configuration
- Cloudflare configuration
- Supabase configuration
- API deployment
- monitoring

PHASE 14 — ANDROID RELEASE

Prepare:

- Android release build
- signing configuration
- app icon
- splash screen
- permissions
- privacy requirements
- data safety documentation
- Play Store assets

Verify current Google Play requirements from official sources before final release.

PHASE 15 — FUTURE MIGRATION

Document how to migrate:

Supabase
→
Dedicated PostgreSQL/API infrastructure

without rewriting the Flutter application.

============================================================
52. TESTING REQUIREMENT
============================================================

After every major phase:

1. Run static analysis.
2. Run formatter.
3. Run unit tests.
4. Build affected targets.
5. Fix errors.
6. Re-run tests.
7. Verify no regression.

Never simply say:

"Implementation complete"

without testing.

============================================================
53. BUILD QUALITY
============================================================

Do not create fake buttons.

Every visible button must have a real action or be explicitly marked as unavailable.

Do not create placeholder pages that appear finished.

Do not use fake API responses in production code.

Do not hard-code user data.

Do not hard-code plan prices.

Do not hard-code storage quotas.

Do not hard-code API limits.

Do not hard-code feature permissions.

============================================================
54. ADMIN-CONTROLLED FEATURES
============================================================

Where reasonable, make the following configurable:

- storage plans
- storage limits
- max file size
- allowed file types
- inactivity policy
- trash retention
- API plans
- API limits
- rate limits
- ads
- maintenance mode
- feature flags
- sharing rules
- upload settings
- system branding
- email templates

============================================================
55. PERFORMANCE REQUIREMENTS
============================================================

The application must avoid unnecessary requests.

Use:

- pagination
- lazy loading
- debounced search
- local caching
- CDN caching
- metadata caching
- batch requests where appropriate
- optimistic UI where safe

Never load thousands of files at once.

Use virtualized lists/grids.

============================================================
56. MOBILE DATA OPTIMIZATION
============================================================

Flutter mobile app must minimize unnecessary network traffic.

Do not automatically download full-size media just to display thumbnails.

Use:

- thumbnails
- metadata
- lazy loading
- cache
- range requests where supported

============================================================
57. MEDIA DELIVERY
============================================================

For large videos:

Do not download the entire video before playback if streaming/range playback is supported.

Use browser/platform-compatible streaming.

If transcoding is later required, design the architecture so transcoding can be added as a separate worker service.

Do not introduce expensive transcoding infrastructure into the MVP unless necessary.

============================================================
58. CLOUD COST MONITORING
============================================================

Create a simple infrastructure usage dashboard or internal monitoring strategy for:

- B2 storage
- B2 transactions where measurable
- Cloudflare requests
- CDN cache ratio where available
- Supabase database usage
- Supabase egress
- Supabase function usage
- API requests
- user storage usage

Add warnings before quotas are exhausted.

Do not assume free-tier limits will never be reached.

============================================================
59. OBSERVABILITY
============================================================

Prepare for:

- application logs
- error tracking
- health checks
- uptime monitoring
- API latency
- failed uploads
- failed webhooks
- database health
- storage errors

Keep the initial implementation inexpensive.

============================================================
60. FUTURE SCALING
============================================================

The architecture must allow future scaling:

Current:

Flutter
→ Supabase
→ B2
→ Cloudflare

Future:

Cloudflare
→ Load Balancer
→ API Server 1
→ API Server 2
→ API Server 3
→ PostgreSQL
→ Redis if necessary
→ B2

Do not introduce distributed architecture prematurely.

Build clean boundaries now so scaling later is possible.

============================================================
61. FUTURE DEDICATED SERVER MIGRATION
============================================================

The current project should not depend permanently on Supabase.

Future target:

Cloudflare
 ↓
Dedicated API Server
 ↓
PostgreSQL
 ↓
B2

Potential components later:

- Docker
- PostgreSQL
- Redis
- background workers
- API gateway
- monitoring
- backup
- load balancing

The migration should primarily involve infrastructure/service implementation, not rewriting the Flutter UI.

============================================================
62. BACKUPS
============================================================

Create a backup strategy for:

- PostgreSQL metadata
- application configuration
- important system settings

Actual user files live in B2 and should rely on appropriate object-storage durability/versioning/backup policies as configured.

Do not confuse database backup with file backup.

============================================================
63. PRIVACY
============================================================

Treat user files as private by default.

Do not expose private file URLs unnecessarily.

Implement:

- account deletion
- data deletion
- privacy settings
- share revocation
- access control
- audit trail

Follow applicable privacy principles.

============================================================
64. ACCESSIBILITY
============================================================

Support:

- readable typography
- keyboard navigation where applicable
- semantic labels
- sufficient contrast
- touch-friendly controls
- screen-reader-friendly labels where Flutter supports them

============================================================
65. INTERNATIONALIZATION
============================================================

Build the application so additional languages can be added later.

Do not hard-code every UI string.

Use localization resources.

Initial language can be English, but architecture must be localization-ready.

============================================================
66. BRANDING
============================================================

Create a professional original brand identity.

Do not copy another company's exact:

- logo
- UI
- colors
- icons
- text
- layout

The product may be inspired by familiar cloud-storage UX patterns but must have an original design.

============================================================
67. FINAL DELIVERABLES
============================================================

At the end, deliver:

1. Working Flutter application
2. Working Web build
3. Android build configuration
4. Desktop build configuration
5. Backend/API
6. Supabase integration
7. B2 integration
8. Cloudflare delivery configuration
9. Developer API
10. Admin panel
11. Authentication
12. Storage management
13. Sharing
14. Media preview
15. Caching
16. Subscription architecture
17. Ads architecture
18. Documentation
19. Testing
20. Deployment guide
21. Environment configuration
22. Security documentation
23. API documentation
24. Migration documentation

============================================================
68. IMPORTANT AGENT BEHAVIOR
============================================================

You are an autonomous senior engineering agent.

Do not merely explain what should be built.

Actually build it.

Before implementation:

- inspect the repository
- understand existing files
- preserve working code
- identify missing components

When a decision is ambiguous:

1. Prefer the simplest production-safe solution.
2. Prefer low operating cost.
3. Prefer scalable architecture.
4. Prefer open standards.
5. Prefer provider abstraction.
6. Avoid unnecessary dependencies.
7. Avoid premature complexity.

If you identify a significantly better architecture than the one specified here, do not silently change it.

Instead:

- explain the improvement
- explain why it is better
- explain cost/complexity implications
- then implement the better option if it clearly improves the product

Do not ask unnecessary questions.

Only ask a question when a missing decision would materially block implementation or create a dangerous/irreversible architectural decision.

Otherwise make a reasonable engineering decision and continue.

============================================================
69. IMPORTANT COST RULE
============================================================

The goal is:

LOW COST + DIRECT FILE DELIVERY + NO UNNECESSARY PROXYING + CACHE + SCALE-READY ARCHITECTURE.

Never design:

Large file
→ API Server
→ B2
→ API Server
→ User

Prefer:

Large file
→ B2
→ Cloudflare/CDN
→ User

The application server should primarily process:

metadata
authentication
authorization
quotas
permissions
signed access
API requests
business logic

============================================================
70. FIRST ACTION
============================================================

Start by inspecting the current repository.

Then create:

/docs/architecture/ARCHITECTURE.md
/docs/architecture/ROADMAP.md
/docs/development/SETUP.md

The architecture document must explain:

- Flutter
- backend
- Supabase
- PostgreSQL
- B2
- Cloudflare
- caching
- Developer API
- security
- storage abstraction
- database abstraction
- migration strategy

Then create a phase-by-phase implementation plan.

Do not start by generating random UI screens.

First establish the architecture and project foundation.

After approval is not required, proceed automatically unless a genuinely blocking decision exists.

============================================================
71. DEFINITION OF DONE
============================================================

A feature is NOT considered complete merely because the UI exists.

A feature is complete only when:

- UI exists
- backend logic exists
- authorization exists
- validation exists
- error handling exists
- database integration exists where required
- storage integration exists where required
- loading state exists
- empty state exists
- failure state exists
- mobile behavior works
- desktop/web behavior works where applicable
- tests exist
- build succeeds

============================================================
FINAL INSTRUCTION
============================================================

Build this project as a real commercial SaaS product.

Prioritize:

SECURITY
RELIABILITY
LOW COST
PERFORMANCE
SCALABILITY
MAINTAINABILITY
GOOD UX
CLEAN CODE
PROVIDER ABSTRACTION

Do not build a fake prototype.

Do not stop at the architecture document.

Move from architecture → implementation → testing → fixing → production readiness phase by phase.

At every stage, report:

- what was implemented
- files/modules created or changed
- tests performed
- errors found
- errors fixed
- remaining risks
- next phase

Then continue to the next phase automatically.