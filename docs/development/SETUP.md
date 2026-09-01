# CloudCols — Development Setup

## Prerequisites

- **Node.js** 18+ (we used v20)
- **npm** 9+
- A code editor: **VS Code** (recommended), with the ESLint + Tailwind extensions.

## Install

```bash
cd cloudcols
npm install
```

## Run (dev)

```bash
npm run dev
# open http://localhost:3000
```

## Useful commands

```bash
npm run dev          # start dev server
npm run build        # production build (type + bundle check)
npm run start        # serve the production build
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm test             # vitest run
```

## Demo accounts (Phase 1 — mock data)

| Area | Credentials | Notes |
|------|-------------|-------|
| App | `demo@cloudcols.com` / `demo1234` | Pro user with developer mode enabled |
| App | register any account | Free plan, 5 GB, ads |
| Admin | `super@cloudcols.com` / `admin` | Super admin; any other email = support role |

The mock layer persists mutations to `localStorage` (key `cloudcols.mockdb.v1`). To reset all demo data, clear that key (or run `resetDb()`).

## Environment

Copy `.env.example` → `.env.local` and fill in values. **Never commit `.env*`.** In Phase 1 the client runs entirely on mock data, so no provider keys are required locally. The `.env` variables document the config surface for the real backend.

## Structure

```
app/            Next.js pages & route groups
components/     UI (ui/), layout, files, upload, preview, admin, brand
lib/
  types/        Domain types (mirror the future DB schema)
  repositories/ Repository contracts + mock implementation
  hooks/        React Query hooks (UI → repository)
  store/        Zustand stores (auth, ui, upload, toast)
  services/     Upload orchestration (ticket → bytes → confirm)
  mock/         In-memory + localStorage mock DB
data/seed.ts    Seed data (the ONLY place sample data lives)
docs/           Architecture, roadmap, API, deployment
```

## Adding a real backend (Phase 2)

1. Implement `lib/repositories/api/*` for each interface in `lib/repositories/types.ts` calling `api.cloudcols.com/v1`.
2. Swap the import in `lib/hooks/queries.ts` from the mock module to the api module.
3. No UI component changes are required — the contracts and types are identical.

## Folder navigation (clean URLs)

`/app/files/[[...path]]` is a catch-all for folder navigation. Each path segment is a folder id (encoded), resolved to a display name via `useFolders()`. Breadcrumbs, folder creation, and uploads target the resolved folder.
