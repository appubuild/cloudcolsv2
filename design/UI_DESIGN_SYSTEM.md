# CloudCols — Design System

**Status:** Approved 2026-08-28 · **This is the index. It defines structure and ownership; it holds no values.**

Previously this file listed token *names* with no values, while the `ui-engineer` skill declared the
design documents "the visual source of truth." That was unsatisfiable — there was no truth to
reference. That conflict is now resolved: every value lives in a dedicated file below, and this
document is the map.

---

## 1. Product Character

Premium, clean, modern, trustworthy, fast — technical without feeling complicated.

CloudCols is **not** a clone of Google Drive, Dropbox, OneDrive, or TeraBox. It borrows familiar
file-management *patterns* (because familiarity reduces cognitive load) and pairs them with an
original visual identity. No competitor's logo, palette, iconography, copy, or layout is reproduced.

The interface serves two audiences at once without becoming two products: people who just want their
files, and developers integrating the API. Density and clarity win over decoration.

---

## 1a. Two Clients, One Design System

CloudCols ships two client implementations:

| Client | Technology | Surfaces |
|--------|-----------|----------|
| `cloudcols-web` | Next.js + TypeScript on Cloudflare Workers | Public website, user web app, **developer portal**, **admin panel** |
| `cloudcols-app` | Flutter | Android, iOS (Desktop on hold) |

They share brand identity, colors, typography, spacing, component behavior, iconography, states, and
UX principles. They do **not** share code. A component name means the same behavior in both.

**Web-only by product decision:** the Developer/API dashboard and the Admin panel are never built in
Flutter (`product-planner` invariant 10).

## 2. Approved Direction

Three foundational decisions, approved 2026-08-28. Changing any of them is a design-system change
requiring re-approval, not an implementation detail.

| Decision | Choice |
|----------|--------|
| **Brand color** | Indigo `#4F46E5` + Cyan `#06B6D4` accent |
| **Typography** | Inter (UI) + JetBrains Mono (code), bundled on native, `font-display: swap` on web |
| **Density** | Balanced — 4px base, 12px card radius, 44px web row, 40px button |

---

## 3. Document Map

Each file owns its domain exclusively. When two documents appear to disagree, the owner wins.

| Document | Owns | Never contains |
|----------|------|----------------|
| [COLORS.md](COLORS.md) | Every color value, semantic token table, file-type colors, chart series, contrast evidence | Sizes, spacing |
| [TYPOGRAPHY.md](TYPOGRAPHY.md) | Font families, type scale, weights, line heights, truncation, i18n text rules | Colors |
| [SPACING.md](SPACING.md) | Spacing scale, radii, elevation, motion, breakpoints, component dimensions, z-order, safe areas | Colors, type |
| [COMPONENTS.md](COMPONENTS.md) | **Canonical component inventory**, naming authority, per-component specs, required empty/error states | New token values |
| [WEB_DESKTOP_UI.md](WEB_DESKTOP_UI.md) | Web shell, screen layouts, keyboard shortcuts, web-specific rules, deferred desktop-wrapper notes | Mobile layout |
| [MOBILE_UI.md](MOBILE_UI.md) | Mobile shell, screen layouts, gestures, Android/iOS divergence, data efficiency | Web layout |
| [INTERACTIONS.md](INTERACTIONS.md) | Timings, thresholds, state machines, focus, announcements | Static visual values |
| [SCREEN_FLOWS.md](SCREEN_FLOWS.md) | Route table, navigation model, end-to-end user flows, build order | Component specs |

**Naming conflicts** between any documents or skills are resolved by [COMPONENTS.md](COMPONENTS.md) §0.

---

## 4. Token Layer Contract

The design system has **one source and two outputs**. Both clients render the same design; only the
technology differs.

```
design/tokens.json                    ← THE source. Every value from COLORS/TYPOGRAPHY/SPACING.
        │
        ▼
packages/design-tokens/  (generator)
        │
        ├──▶ cloudcols-app/lib/design/tokens/*.dart      Flutter ThemeExtensions   [GENERATED]
        │
        └──▶ cloudcols-web/src/styles/globals.css        CSS custom properties     [GENERATED]
             cloudcols-web/tailwind.config.ts            Tailwind theme            [GENERATED]
```

**To change a value:** edit `design/tokens.json`, regenerate, commit both outputs. Never hand-patch a
generated file — the two clients drift within weeks otherwise, and the drift is invisible until
someone compares screenshots.

### Forbidden in both clients
- Hex color literals
- Font-size numeric literals
- Padding, margin, radius, or spacing numeric literals
- Animation duration literals
- Arbitrary Tailwind values (`text-[#4F46E5]`, `p-[13px]`) on web
- `Platform.isAndroid` / `Platform.isIOS` inside shared Flutter business logic

These are build-blocking review failures, not style preferences.

### Platform implementation
| | Flutter (`cloudcols-app`) | Web (`cloudcols-web`) |
|---|---|---|
| Token carrier | `ThemeExtension` | CSS custom properties + Tailwind theme |
| Theme switch | `ThemeMode` + `platformBrightness` | `:root` / `[data-theme="dark"]` + `prefers-color-scheme` |
| Component base | Material widgets styled from tokens | Headless primitives styled from tokens |
| Owner skill | `ui-engineer` | `web-engineer` |

Web must resolve the theme in a blocking inline script before first paint — a flash of the wrong
theme is a visible defect.

## 5. Theme Requirements

Every screen ships **Light**, **Dark**, and **System**.

Dark mode is a designed theme, not an inversion: in dark, elevation *raises* luminance
(`background #0B0D14` → `surface #141824` → `elevatedSurface #1C2130`); in light it lowers it.
Surfaces are slightly indigo-tinted rather than neutral grey so the brand color sits in the same
family as its background.

Theme switching must not lose scroll position, selection, or in-flight transfers.

---

## 6. Accessibility Baseline

Non-negotiable, verified per screen:

- Body text ≥ 4.5:1; interactive borders, focus rings, and icon-only controls ≥ 3:1
- Status **never** communicated by color alone — always color + icon + text
- Visible focus ring on every focusable element, never removed
- Full keyboard operability on web
- Touch targets ≥ 48×48 on mobile, ≥ 40×40 for pointer targets on web
- Text scaling honored from 0.85× to 1.60× without clipping
- Accessible name on every control (`Semantics` in Flutter, `aria-label` on web); tooltips on icon-only controls
- Reduced-motion honored, except progress indicators, which convey information
- Meaningful, actionable error messages — never codes or stack traces

Contrast evidence for the full palette: [COLORS.md](COLORS.md) §5 (37/37 pairs pass).

---

## 7. Security Boundary

The UI layer may **never**:

- Contain storage-provider credentials, service-role keys, or admin secrets
- Decide authorization — it requests, the server decides
- Trust client-side quota, plan, entitlement, or payment values
- Construct storage URLs to bypass server authorization
- Render internal identifiers, object keys, bucket names, or stack traces
- Cache private content in a way that could serve one user's data to another

See the `security-engineer` skill for enforcement and verification.

---

## 8. Visual QA Gate

A screen is complete only after: implementation → build/run → visual inspection of the rendered
result → responsive inspection → Light/Dark inspection → state inspection (loading, empty, error,
offline, permission denied, quota exceeded) → accessibility check → tests pass.

"It compiles" is not done. "It looks right in one theme at one width" is not done.

Per-artifact checklists: [COMPONENTS.md](COMPONENTS.md) §13 · [WEB_DESKTOP_UI.md](WEB_DESKTOP_UI.md) §6 ·
[MOBILE_UI.md](MOBILE_UI.md) §11 · [INTERACTIONS.md](INTERACTIONS.md) §13.
