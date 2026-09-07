---
name: ui-engineer
description: How CloudCols Flutter UI is built (cloudcols-app - Android and iOS). Use when creating or changing any Flutter widget, screen, theme, or layout, or doing visual QA on mobile. Enforces the generated design token layer and the shared component library in design/. Web is owned by web-engineer, not this skill.
---

# UI Engineer Skill — CloudCols (Flutter)

## Scope
This skill covers **`cloudcols-app` only** — the Flutter application for **Android and iOS**.

| Not in scope | Owner |
|--------------|-------|
| Web app, public website, admin panel, developer portal | `web-engineer` |
| Flutter Desktop (Windows/macOS/Linux) | **ON HOLD** — see `product-planner` section 8. Desktop is planned as a wrapper around `cloudcols-web`, not a Flutter target. |
| Developer/API dashboard and key management | `web-engineer` — **web-only by product decision** (`product-planner` invariant 10). Never build these screens in Flutter. |

## When to use this skill
Load it whenever you create or modify a Flutter widget, screen, theme, or layout in `cloudcols-app`,
and whenever you perform visual QA on mobile.

For *what* to build → `product-planner`. For how an interaction should *behave* → `product-experience`.
For anything touching credentials or authorization → `security-engineer` (**overrides this skill**).

## Source of truth
The `design/` documents hold **every visual value**, and they are **shared with the web client**.
This skill holds **how to build with them in Flutter**. It deliberately contains no color, size, or
spacing values — quoting them here would create a second source of truth that drifts.

Same design system, two implementations. A `FileCard` must look and behave the same in both clients;
only the technology differs.

| Need | Read |
|------|------|
| Color values, semantic tokens, contrast evidence | [design/COLORS.md](../../../design/COLORS.md) |
| Font families, type scale, truncation, i18n text | [design/TYPOGRAPHY.md](../../../design/TYPOGRAPHY.md) |
| Spacing, radii, elevation, motion, breakpoints, dimensions, z-order | [design/SPACING.md](../../../design/SPACING.md) |
| **Canonical component names and specs** (shared with web) | [design/COMPONENTS.md](../../../design/COMPONENTS.md) |
| Mobile screen layouts, gestures, Android/iOS divergence | [design/MOBILE_UI.md](../../../design/MOBILE_UI.md) |
| Routes, navigation model, user flows | [design/SCREEN_FLOWS.md](../../../design/SCREEN_FLOWS.md) |
| Timings, thresholds, state machines | [design/INTERACTIONS.md](../../../design/INTERACTIONS.md) |
| Structure and ownership map | [design/UI_DESIGN_SYSTEM.md](../../../design/UI_DESIGN_SYSTEM.md) |

## API access
Never hand-write an API client. `cloudcols-app` consumes the **generated Dart client** from
`packages/contracts`, produced from the OpenAPI spec (`product-planner` invariant 5). If an endpoint
is missing, the spec changes first, then the client regenerates.

## Mission
Act as the project's Senior Product Designer, UI Architect, Flutter UI Engineer, Accessibility Specialist, Responsive Design Engineer, and Visual QA Engineer.

The product is a premium cloud-storage/file-management application. Maintain one coherent design language with the web client while respecting Android and iOS platform conventions.

The approved design documents are the visual source of truth. Do not invent a competing visual system.

## Mandatory Workflow
Before changing UI:
1. Inspect the existing design system and theme/token files.
2. Inspect reusable components before creating anything new.
3. Inspect the target screen, route, state model, and related screens.
4. Identify phone/tablet and Android/iOS behavior.
5. Implement with reusable components and centralized tokens.
6. Run/build the relevant target.
7. Perform visual QA.
8. Test loading, empty, error, offline, permission, quota, upload, download, and success states where applicable.
9. Check Light, Dark, and System themes.
10. Fix visual inconsistencies before handoff.

Never declare a UI task complete merely because the code compiles.

## Design Tokens

All visual primitives are centralized in `lib/design/tokens/`. The **values** are defined in
`design/COLORS.md`, `design/TYPOGRAPHY.md`, and `design/SPACING.md` — read them there. Do not
re-declare token names or values in this file or in code comments.

### Token layer contract
Tokens are **generated**, never hand-written:
```
design/tokens.json ──▶ packages/design-tokens ──▶ lib/design/tokens/*.dart   (Flutter)
                                              └─▶ globals.css + tailwind      (Web)
```
```
lib/design/tokens/           ← GENERATED, do not edit by hand
  app_colors.dart · app_typography.dart · app_spacing.dart · app_radius.dart
  app_elevation.dart · app_motion.dart · app_breakpoints.dart · app_dimens.dart
  app_theme.dart        ← assembles ThemeData light/dark from the above
```
Every token is a Flutter `ThemeExtension`, so a future density or brand variant swaps without
touching widgets. To change a value, edit `design/tokens.json` and regenerate — never patch the
Dart output, or web and mobile will drift. Material's `ColorScheme` and `TextTheme` are populated **from** these tokens so
stock Material widgets inherit the brand.

### Forbidden outside `lib/design/tokens/`
These are build-blocking review failures, not style preferences:
- Hex color literals
- `fontSize:` numeric literals
- Padding, margin, radius, or `SizedBox` numeric literals
- `Duration(milliseconds: …)` for animation
- `Platform.isAndroid` / `Platform.isIOS` inside shared business logic
- Any `isMobile` boolean — the single responsive helper is `AppBreakpoint.of(context)`

### Standing rules
- Never communicate state with color alone; always color + icon + text.
- Respect user text scaling (clamped 0.85–1.60) and reduced-motion preferences.
- Nested radii decrease inward.
- Elevation raises luminance in dark mode and lowers it in light — never derive one theme from the other.

## Component Library

The **canonical component inventory is `design/COMPONENTS.md`**. It holds every component name, its
spec, its required states, and the naming-authority table that resolves aliases used elsewhere in
these skills (for example `MobileBottomNavigation` -> `AppBottomNav`).

Before writing any widget:
1. Search `design/COMPONENTS.md`. If the component exists, use or extend it.
2. If it does not exist, add its entry there **first** -- name, spec, states -- then implement.
3. A component that ships without an entry is a review failure.

Shared contract, two implementations: a component name means the same behavior, states, and
semantics in Flutter and in React. Only the technology differs. If a component's behavior needs to
change, update `design/COMPONENTS.md` so both clients change together.

Adaptive-by-default within Flutter: phone and tablet presentations of one concept are **one widget
with a responsive body**, not two widgets.

## Feature UX Specifications

These specifications previously lived here as bullet lists. They now live in the design documents,
in far more detail, so there is exactly one place to read them. Consult the owner before building:

| Area | Owner document |
|------|----------------|
| File manager: list/grid, search, sort, filter, breadcrumbs, multi-select | `design/MOBILE_UI.md` |
| Canonical file action order (Open, Preview, Download, Share, Rename, Move, Copy, Favorite, Details, Delete) | `design/COMPONENTS.md` section 3 |
| Upload and download UX, queue behavior, per-item states | `design/COMPONENTS.md` section 6 + `design/INTERACTIONS.md` sections 3-4 |
| Media preview: image, video, audio, PDF, unsupported | `design/COMPONENTS.md` section 7 + `design/INTERACTIONS.md` section 8 |
| Mobile navigation, gestures, Android/iOS divergence | `design/MOBILE_UI.md` |
| Tablet layout and orientation | `design/MOBILE_UI.md` + `design/SPACING.md` section 5 |
| Responsive breakpoints and per-breakpoint layout | `design/SPACING.md` section 5 + `design/MOBILE_UI.md` |
| Required empty states and error states | `design/COMPONENTS.md` sections 11-12 |
| Timings, thresholds, state machines | `design/INTERACTIONS.md` |

Two rules from the original list are important enough to restate here because they are violated most often:

- **Uploads must never freeze the application.** The user keeps browsing while transfers run.
- **Never show fake or simulated progress**, and never expose storage-provider credentials, object
  keys, bucket names, or internal identifiers in the UI.

## Accessibility (implementation)

The accessibility **baseline** is defined in `design/UI_DESIGN_SYSTEM.md` section 6, and the
**verification process** belongs to `product-experience`. This skill covers how to satisfy it in Flutter:

- Wrap every interactive widget in `Semantics` with a meaningful label; never rely on the child text alone for icon-only controls.
- Every icon-only control needs a `Semantics` label; long-press reveals a tooltip where useful.
- Keep focus traversal order matching visual order; use `FocusTraversalGroup` where the widget tree diverges from the visual layout (external keyboards on tablets).
- Never remove the focus ring. Use the `focusRing` token, 2px with 2px offset.
- Honor `MediaQuery.disableAnimations` for every animation except progress indicators.
- Clamp `textScaler` to 0.85-1.60 and switch fixed-height rows to intrinsic height above 1.30.
- Announce state changes that are otherwise visual only, per `design/INTERACTIONS.md` section 12.
- Touch targets: 48x48 minimum, padding the hit area when the glyph is smaller.

## Performance (implementation)

- `ListView.builder` / `GridView.builder` with `itemExtent` or `prototypeItem` wherever row height is fixed.
- Load the thumbnail variant in lists; never decode full-resolution media for a cell.
- Set `cacheWidth` / `cacheHeight` on every network image so decoding is bounded.
- Keep `setState` scoped; prefer `select`-style narrow watches over rebuilding a whole screen.
- `const` constructors everywhere they apply.
- Debounce search input (300ms) and deduplicate identical in-flight requests.
- Paginate at 40 items with infinite scroll.
- `RepaintBoundary` around independently animating subtrees such as transfer progress rows.
- Avoid blur and large shadows on scrolling content.
- Optimistic UI only where a rollback path exists; see `design/INTERACTIONS.md` section 2.

UI caching must never bypass authorization or expose private content.

## Security Boundary
UI must never:
- contain privileged credentials
- contain B2/private storage credentials
- contain Supabase service-role credentials
- contain admin secrets
- decide authorization
- trust client-side quota/plan values
- construct privileged private URLs to bypass backend authorization

The UI can request an operation; trusted backend logic must authorize it.

## Visual QA Checklist
Before handoff:
- [ ] Design tokens reused
- [ ] No unnecessary duplicated components
- [ ] Light theme checked
- [ ] Dark theme checked
- [ ] System theme checked
- [ ] Loading state checked
- [ ] Empty state checked
- [ ] Error state checked
- [ ] Offline state considered
- [ ] Permission-denied state checked
- [ ] Quota-exceeded state checked
- [ ] Upload/download states checked
- [ ] Responsive behavior checked
- [ ] Accessibility checked
- [ ] Overflow/truncation checked
- [ ] No secrets exposed
- [ ] Build/tests pass
- [ ] Visual QA completed
- [ ] No hardcoded prices, quotas, or limits
- [ ] `dart format` applied and `flutter analyze` clean

## Definition of Done
A UI task is complete when every box above is checked **and** the artifact-specific checklist in the
owning design document passes:

- Component -> `design/COMPONENTS.md` section 13
- Mobile screen -> `design/MOBILE_UI.md` section 11
- Interaction -> `design/INTERACTIONS.md` section 13

"It compiles" is not done. "It looks right in one theme at one width" is not done.
