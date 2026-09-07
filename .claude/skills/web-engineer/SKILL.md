---
name: web-engineer
description: How CloudCols web is built - Next.js + TypeScript on Cloudflare Workers (cloudcols-web). Use when creating or changing any web page, React component, route handler, server action, SEO surface, admin panel screen, or developer portal screen. Covers rendering strategy, the BFF layer, design token consumption, and web security.
---

# Web Engineer Skill — CloudCols

## When to use this skill
Load it whenever you create or modify anything in `cloudcols-web`: a page, layout, React component,
route handler, server action, middleware, SEO surface, admin screen, or developer-portal screen.

For *what* to build and whether it is in scope → `product-planner`.
For Flutter → `ui-engineer`.
For how an interaction should behave → `product-experience`.
For anything touching credentials or authorization → `security-engineer` (**overrides this skill**).

## Scope

`cloudcols-web` owns four products on one origin:

| Surface | Rendering | Notes |
|---------|-----------|-------|
| Public website (home, pricing, blog, legal) | **SSG** | SEO-critical |
| Public share pages `/s/:token` | **SSR** | OG tags server-rendered — the commercially important one |
| Developer documentation | **SSG** | SEO-critical; developers arrive from search |
| User web app (file manager, preview, sharing) | **CSR** behind auth | No SEO value |
| Developer portal (dashboard, keys, webhooks) | **CSR** behind auth | **Web-only** — never in Flutter |
| Admin panel | **CSR** behind auth + server-side role gate | Route hiding is not access control |

---

## Source of truth
`design/` holds **every visual value**, shared with Flutter. This skill holds **how to build with them
in React**. It contains no color, size, or spacing values.

| Need | Read |
|------|------|
| Color values, semantic tokens, contrast evidence | [design/COLORS.md](../../../design/COLORS.md) |
| Font families, type scale, truncation, i18n text | [design/TYPOGRAPHY.md](../../../design/TYPOGRAPHY.md) |
| Spacing, radii, elevation, motion, breakpoints, dimensions, z-order | [design/SPACING.md](../../../design/SPACING.md) |
| Canonical component names and specs | [design/COMPONENTS.md](../../../design/COMPONENTS.md) |
| Web screen layouts and keyboard shortcuts | [design/WEB_DESKTOP_UI.md](../../../design/WEB_DESKTOP_UI.md) |
| Routes, navigation model, user flows | [design/SCREEN_FLOWS.md](../../../design/SCREEN_FLOWS.md) |
| Timings, thresholds, state machines | [design/INTERACTIONS.md](../../../design/INTERACTIONS.md) |

---

## Token consumption

Tokens are **generated**, never hand-written:

```
design/tokens.json ──▶ packages/design-tokens ──▶ globals.css (CSS custom properties)
                                              └─▶ tailwind.config.ts (theme extension)
```

- Light/dark switch via `:root` and `[data-theme="dark"]` CSS variables, honoring `prefers-color-scheme` when the user has not chosen.
- **Never** a raw hex, px, or ms literal in a component. Use the Tailwind token class or the CSS variable.
- Theme must not flash on load — resolve theme in a blocking inline script before first paint.
- Dark mode is a designed theme, not an inversion. The generator emits both; do not compute one from the other.

**Forbidden in `cloudcols-web`:**
- Hex colors, arbitrary Tailwind values (`text-[#4F46E5]`, `p-[13px]`)
- Hard-coded prices, quotas, limits, feature flags — all come from the API
- Any B2, Supabase service-role, or admin secret in client-reachable code
- `NEXT_PUBLIC_` on anything that is not genuinely public
- Direct browser calls to `api.cloudcols.com` (see BFF below)

---

## Architecture rules

### The BFF boundary
```
Browser ──same-origin fetch──▶ Next.js route handler ──service binding──▶ API Worker
          httpOnly cookie                                zero-latency
```
- The browser **never** calls `api.cloudcols.com` directly. That origin exists for Flutter and third-party developers.
- Session JWT lives in an httpOnly `SameSite=Lax` cookie. It must never be readable by client JavaScript.
- State-changing route handlers require a CSRF token.
- Route handlers are thin: authenticate, forward, shape the response. **Business logic belongs in the API Worker**, not here — duplicating it would break the single-implementation rule.

### Rendering strategy
- Default to **Server Components**. Add `"use client"` only where interactivity genuinely requires it.
- Public pages: SSG with revalidation. Share pages: SSR (fresh authorization + OG tags).
- Never leak a signed URL, object key, bucket name, or internal identifier into server-rendered HTML.

### Uploads
- Request a presigned multipart URL from the API, then upload **directly to B2 from the browser**.
- Never proxy file bytes through a route handler — the Cloudflare request body cap makes it impossible for large files (see `product-planner` invariant #1).
- Resumable: persist part state so a reload can continue.
- Generate the thumbnail client-side (`<video>` seek → `<canvas>` capture) and upload it alongside.

---

## Components

`design/COMPONENTS.md` is the canonical inventory and naming authority, shared with Flutter. React
components use the same names in PascalCase (`FileCard`, `TransferQueuePanel`, `AppBottomNav`).

- Same name = same behavior, states, and props semantics across web and Flutter. Implementation differs; contract does not.
- Before writing a component, search `design/COMPONENTS.md`. If missing, add the entry first.
- Implement every applicable state from its §1 universal state contract.
- Prefer headless primitives (Radix or equivalent) styled with tokens over opinionated component libraries that fight the design system.

---

## Accessibility (implementation)

The baseline is `design/UI_DESIGN_SYSTEM.md` §6; verification belongs to `product-experience`.
In React:

- Semantic HTML first — `<button>`, `<nav>`, `<main>`, `<table>`. This is the whole reason we left Flutter Web; do not rebuild everything from `<div>`.
- Visible focus ring on every focusable element; never `outline: none` without a replacement.
- Icon-only controls need `aria-label` and a tooltip.
- Dialogs/sheets trap focus and restore it on close; `Escape` closes the topmost layer.
- Announce async state changes via `aria-live` per `design/INTERACTIONS.md` §12.
- Honor `prefers-reduced-motion` for everything except progress indicators.
- Support browser zoom to 200% and OS text scaling without clipping.
- Real text, real DOM — never render content into canvas.

## Performance

- Ship as little client JS as possible; keep heavy libraries (PDF, video, charts) behind `dynamic()`.
- Virtualize file lists and grids; paginate at 60 items.
- `next/image` for thumbnails with explicit sizes; never load full-resolution media into a list.
- Debounce search at 300ms; dedupe in-flight requests.
- Stream SSR responses; do not block on non-critical data.
- Cache: public/immutable assets at the CDN; **private API responses are `private, no-store`**.
- Budget: LCP < 2.5s and CLS < 0.1 on the marketing and share pages.

## SEO

- Per-route `metadata` with title, description, canonical, and OpenGraph/Twitter tags.
- Share pages `/s/:token` render OG image, title, file type, and size server-side — the single feature Flutter Web could not provide.
- `sitemap.xml` and `robots.txt` generated; authenticated routes `noindex`.
- Structured data on pricing and documentation pages.
- Never index share tokens, admin routes, or developer-portal routes.

## Security boundary

The web client may never: hold storage or service-role credentials · decide authorization · trust
client-side quota, plan, or payment values · construct storage URLs to bypass the API · render
internal identifiers or stack traces · cache private content where another user could receive it.

Additionally, specific to web:
- Strict CSP; no `unsafe-inline` scripts.
- Sanitize any user-supplied HTML; filenames are untrusted input and are escaped everywhere.
- `rel="noopener noreferrer"` on external links.
- Validate every route-handler input server-side, regardless of client validation.

---

## Definition of Done

- [ ] Entry exists in `design/COMPONENTS.md` (for new components)
- [ ] All applicable states implemented (default, hover, focus, pressed, selected, disabled, loading, error)
- [ ] Loading, empty, error, offline states for every data-bearing view
- [ ] Only generated tokens used — no raw values
- [ ] Light, Dark, and System verified, no theme flash
- [ ] Responsive at `xs`, `md`, `lg`, `xl`
- [ ] Full keyboard traversal with visible focus
- [ ] Semantic HTML; `aria-label` on icon-only controls
- [ ] Browser back/forward correct; scroll position preserved
- [ ] Long filenames and 200% zoom do not clip
- [ ] SEO metadata present (public routes) or `noindex` (authenticated routes)
- [ ] No secrets, storage URLs, or internal identifiers in the payload
- [ ] `tsc --noEmit` and `eslint` clean; `next build` succeeds
- [ ] Component/integration tests pass

"It compiles" is not done. "It looks right in one theme at one width" is not done.
