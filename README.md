# CloudCols

A secure, fast cloud storage & media platform — Google Drive / Dropbox class, with its own branding, developer API, and admin panel.

> **Phase 1 (current):** a production-quality **mock-data web application** built on a repository abstraction so the real backend (Supabase + Backblaze B2 + Cloudflare) can be swapped in without rewriting the UI.

## Features (Phase 1)

- **Auth** — register, login, password reset, role-gated routing.
- **File manager** — folders (clean URLs), grid/list, breadcrumbs, search, sort, filter, rename, move, delete→trash, restore, permanent delete, favorites, recent, bulk actions, drag-and-drop upload.
- **Upload tray** — persistent tray with progress %, speed, ETA, cancel, retry, and server-side quota + max-file-size checks.
- **Auto-categorization** — categories derived server-side from MIME + extension (image/video/audio/pdf/document/archive/other).
- **Preview** — unified overlay for image, video, audio, PDF, and other types.
- **Sharing** — secure share links (view/download), revoke, and explicit public share states (valid/expired/revoked/not-found).
- **Storage** — usage ring by category, plan comparison, quota enforcement.
- **Settings** — profile, security, notifications, billing & plan, danger zone.
- **Developer portal** — enablement, scoped API keys (secret shown once), docs, usage analytics, webhooks, billing. (Separate product from storage plans.)
- **Admin panel** — dashboard, users, storage operations (metadata-only boundary), plans, subscriptions, payments, API, ads, content, security.
- **Marketing site** — home, features, pricing, security, privacy, terms.
- **Design system** — light + dark, responsive, accessible, no hard-coded prices.

## Tech

Next.js 14 (App Router) · TypeScript · Tailwind · React Query · Zustand · lucide-react.

## Docs

- Architecture: `docs/architecture/ARCHITECTURE.md`
- Roadmap: `docs/architecture/ROADMAP.md`
- Setup: `docs/development/SETUP.md`
- API (developer): `docs/api/` (see also `/developers/docs` in the app)

## Quick start

```bash
npm install
npm run dev
```

Demo login: `demo@cloudcols.com` / `demo1234`.
Admin login: `/admin/login` → `super@cloudcols.com` / `admin`.

## Demo map (routes)

| URL | What |
|-----|------|
| `/` | Marketing home (copy editable via the landing CMS) |
| `/app` | Product dashboard (requires sign-in) |
| `/app/files` | File manager |
| `/developers` | Developer portal |
| `/admin/content` | Content manager — **Landing** tab edits live landing copy |
| `/admin` | Admin panel |

## Swapping mock → real

`lib/repositories/types.ts` defines the contracts. Phase 2 implements `Api*` repositories against `api.cloudcols.com/v1` and swaps the module referenced in `lib/hooks/queries.ts`. See `docs/architecture/ARCHITECTURE.md`.
