# CloudCols — Spacing, Shape, Elevation, Motion, Layout

**Status:** Approved 2026-08-28 · Single source of truth for spacing, radii, shadows, motion, breakpoints, and z-order.

Approved density: **Balanced** — 4px base unit, 12px card radius, 44px web row, 40px button.

> **Rule:** No numeric literal for padding, radius, or duration in either client.
> `SizedBox(height: 16)` and `p-[13px]` are both review failures; `SizedBox(height: AppSpacing.md)`
> and `p-md` are correct. Values originate in `design/tokens.json`; see §9.

---

## 1. Spacing Scale

Base unit **4px**. Only these values exist.

| Token | Value | Primary use |
|-------|-------|-------------|
| `none` | 0 | |
| `xxs` | 2 | icon-to-badge nudge |
| `xs` | 4 | icon-to-label inside a chip |
| `sm` | 8 | inside compact controls, chip padding |
| `md` | 12 | list item internal padding, icon-to-text |
| `lg` | 16 | **default gap** — card padding, grid gutter, screen edge (mobile) |
| `xl` | 24 | section gap, screen edge (web/tablet), dialog padding |
| `xxl` | 32 | major section separation |
| `xxxl` | 48 | empty-state vertical rhythm, hero padding |
| `huge` | 64 | marketing/pricing hero only |

Values above 64 are not tokenized; a layout needing more is wrong.

### Layout paddings

| Context | Padding |
|---------|---------|
| Mobile screen horizontal edge | `lg` (16) |
| Tablet screen horizontal edge | `xl` (24) |
| Web content area | `xl` (24) |
| Card internal | `lg` (16) |
| Dialog internal | `xl` (24) |
| Bottom sheet internal | `lg` (16) horizontal, `md` (12) top, `lg` + safe area bottom |
| List item horizontal | `lg` (16) |
| Section vertical gap | `xl` (24) |
| Form field vertical gap | `lg` (16) |
| Grid gutter | `lg` (16) |

---

## 2. Radii

| Token | Value | Applied to |
|-------|-------|------------|
| `radiusXs` | 4 | badge, tag, progress bar, checkbox |
| `radiusSm` | 8 | input, small button, chip, thumbnail |
| `radiusMd` | 12 | **card, file card, folder card, menu, tooltip** |
| `radiusLg` | 16 | dialog, panel, large surface |
| `radiusXl` | 20 | bottom sheet top corners, media viewer chrome |
| `radiusPill` | 999 | avatar, pill button, filter chip, storage bar |

Rule: nested radii must decrease inward. A `radiusSm` thumbnail inside a `radiusMd` card is correct; the reverse is not.

---

## 3. Elevation

Elevation is a **shadow set in light** and a **surface-luminance step in dark**. Dark mode uses shadows only for the top two levels, and only as a subtle black spread — never the same shadow values as light.

| Level | Use | Light shadow | Dark treatment |
|-------|-----|--------------|----------------|
| `e0` | Flush content, table rows | none | `background` |
| `e1` | Cards, sidebar, list surfaces | `0 1px 2px rgba(15,23,42,.06)` + 1px `border` | `surface` (`#141824`), 1px `border` |
| `e2` | Hovered card, sticky toolbar | `0 2px 8px rgba(15,23,42,.08)` | `elevatedSurface` (`#1C2130`) |
| `e3` | Dropdown, context menu, popover | `0 8px 24px rgba(15,23,42,.12)` | `elevatedSurface` + `0 8px 24px rgba(0,0,0,.5)` |
| `e4` | Dialog, bottom sheet, drawer | `0 16px 48px rgba(15,23,42,.16)` | `surfaceOverlay` (`#232939`) + `0 16px 48px rgba(0,0,0,.6)` |
| `e5` | Toast, tooltip, FAB, media chrome | `0 12px 32px rgba(15,23,42,.20)` | `surfaceOverlay` + `0 12px 32px rgba(0,0,0,.6)` |

Never combine an elevation shadow with a decorative border on the same edge in light mode, except `e1`, which uses both deliberately.

---

## 4. Motion

| Token | Duration | Curve | Use |
|-------|----------|-------|-----|
| `instant` | 0ms | — | selection checkbox, theme swap |
| `fast` | 120ms | `easeOut` | hover, focus, press, ripple |
| `base` | 200ms | `easeInOutCubic` | **default** — expand/collapse, fade, tab switch |
| `slow` | 300ms | `easeInOutCubic` | dialog, bottom sheet, drawer, page transition |
| `deliberate` | 400ms | `easeOutCubic` | image viewer open, first-run reveal |

Rules:
- Nothing animates longer than 400ms. Ever.
- Progress bars and counters update **linearly** and continuously — they do not use these curves.
- Skeleton shimmer: 1200ms linear loop.
- **Reduced motion** (`MediaQuery.disableAnimations` in Flutter, `prefers-reduced-motion` on web): all of the above collapse to `instant` except progress indicators, which keep updating because they convey information. Shimmer becomes a static `skeletonBase` fill.
- Never animate a layout that contains an in-flight upload row.

### Page transitions

| Platform | Forward | Back |
|----------|---------|------|
| Android | shared-axis X, `slow` | system back gesture / predictive back |
| iOS | Cupertino slide, `slow` | interactive swipe-from-left-edge (mandatory) |
| Web | fade `base` (no slide — it fights browser history) | browser back |

---

## 5. Breakpoints

| Name | Range | Navigation | File grid columns |
|------|-------|------------|-------------------|
| `xs` | < 480 | bottom nav | 2 |
| `sm` | 480–767 | bottom nav | 3 |
| `md` | 768–1023 | navigation rail (collapsed sidebar) | 4 |
| `lg` | 1024–1439 | expanded sidebar | 5 |
| `xl` | 1440–1919 | expanded sidebar + details panel | 6 |
| `xxl` | ≥ 1920 | expanded sidebar + details panel, content max-width 1600 | 7 |

Breakpoints key off **layout width**, not device type — a browser window resized to 700px gets the `sm` layout. There is no `isMobile` boolean in either codebase: Flutter uses `AppBreakpoint.of(context)`, web uses Tailwind screens generated from the same pixel values.

`cloudcols-app` (Flutter) only ever encounters `xs` through `md` in practice — phone and tablet. The
`lg`+ ranges exist in its tokens for tablet landscape, not for desktop.

The image gallery uses its own adaptive column count (see [MOBILE_UI.md](MOBILE_UI.md) §Gallery).

---

## 6. Component Dimensions

| Element | Web | Mobile |
|---------|-------------|--------|
| Top header height | 60 | 56 (AppBar) |
| Sidebar expanded | 256 | — |
| Sidebar collapsed | 72 | — |
| Bottom navigation | — | 64 + safe area |
| List row | 44 | 56 |
| Dense table row | 40 | — |
| Grid card | 180 × 200 | fills column, 4:5 aspect |
| Thumbnail in list | 32 × 32 | 40 × 40 |
| Button height | 40 | 48 |
| Small button | 32 | 40 |
| Input height | 40 | 48 |
| Search bar | 36 (header) | 44 |
| FAB | — | 56 |
| Icon button hit area | 40 × 40 | 48 × 48 |
| Icon glyph | 20 (24 in nav) | 24 |
| Avatar | 32 (header), 24 (list) | 36 (header), 40 (profile row) |
| Details panel width | 360 | full-screen sheet |
| Dialog max width | 480 (sm) / 640 (md) / 800 (lg) | full width − 32 |
| Bottom sheet max height | — | 90% of viewport |
| Upload panel (docked) | 400 × 320 | full-width sheet |
| Minimum touch target | 40 × 40 | **48 × 48** |
| Minimum supported viewport | 320 × 568 | 320 × 568 |

Touch targets on mobile are never below 48×48, even when the visible glyph is 24px — pad the hit area.

---

## 7. Z-Order

Fixed stacking contract. Nothing invents its own value.

| Layer | z | Notes |
|-------|---|-------|
| Base content | 0 | |
| Sticky table header / toolbar | 10 | |
| Sidebar / bottom nav | 20 | |
| Top header | 30 | |
| FAB | 40 | |
| Docked upload panel | 50 | above FAB, below sheets |
| Audio mini-player | 55 | sits above bottom nav, below sheets |
| Dropdown / context menu / popover | 60 | |
| Bottom sheet / drawer | 70 | |
| Dialog + scrim | 80 | |
| Media viewer (fullscreen) | 90 | |
| Toast / snackbar | 100 | above everything except… |
| Offline banner | 110 | must always be visible |

The audio mini-player and the docked upload panel can coexist — the mini-player stacks above the bottom nav, and the upload panel offsets upward to clear it.

---

## 8. Safe Areas and Keyboard

- Every mobile screen bottom respects `MediaQuery.viewPadding.bottom` (gesture bar, home indicator); web uses `env(safe-area-inset-bottom)` where relevant.
- Bottom sheets add `viewInsets.bottom` when a field inside them is focused.
- Fullscreen media viewers go edge-to-edge but keep controls inside the safe area.
- Forms scroll the focused field into view above the keyboard, and the primary action stays reachable.
- Landscape: media viewers go immersive; all other screens keep the safe area and constrain content to a max readable width.

---

## 9. Implementation Contract

Generated from `design/tokens.json` into both clients.

| | Flutter (`cloudcols-app`) | Web (`cloudcols-web`) |
|---|---|---|
| Spacing, radii, dimensions | `app_spacing.dart`, `app_radius.dart`, `app_dimens.dart` as `ThemeExtension`s | Tailwind `spacing` / `borderRadius` theme |
| Elevation | `app_elevation.dart` — per-theme shadow sets | Tailwind `boxShadow` + surface tokens |
| Motion | `app_motion.dart` — durations, curves, reduced-motion resolution | CSS variables + `prefers-reduced-motion` media query |
| Breakpoints | `app_breakpoints.dart` — `AppBreakpoint.of(context)` | Tailwind screens (same pixel values) |

Both clients use the **same breakpoint pixel values** so a given viewport width produces the same
layout decision on either platform. Flutter's breakpoints apply to phone and tablet only — the `lg`
and above ranges exist in the Flutter tokens for tablet landscape, not for desktop.

## 10. Cross-references

- Colors → [COLORS.md](COLORS.md) · Typography → [TYPOGRAPHY.md](TYPOGRAPHY.md)
- Component specs using these values → [COMPONENTS.md](COMPONENTS.md)
- Interaction timing and gesture rules → [INTERACTIONS.md](INTERACTIONS.md)
