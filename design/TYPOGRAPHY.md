# CloudCols — Typography

**Status:** Approved 2026-08-28 · Single source of truth for every font family, size, weight, and line height.

Approved direction: **Inter (UI) + JetBrains Mono (code)**.

> **Rule:** No literal font size in either client. Flutter uses `Theme.of(context).textTheme.*` or
> `AppText.*`; web uses the generated Tailwind type classes. A literal size is a review failure.

---

## 1. Families

| Role | Family | Fallback stack |
|------|--------|----------------|
| UI (everything) | **Inter** | `-apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif` |
| Code / secrets / IDs | **JetBrains Mono** | `SF Mono, Consolas, Roboto Mono, monospace` |

### Loading strategy

| Platform | Method | Notes |
|----------|--------|-------|
| Android / iOS (`cloudcols-app`) | **Bundled** in `assets/fonts/` | No network dependency; deterministic rendering; app size cost ≈ 400 KB for the subset below |
| Web (`cloudcols-web`) | **`next/font` self-hosted** | Served from our own origin — no third-party request, tighter CSP, no render-blocking external fetch. `font-display: swap` with the fallback stack |

**Bundled weights only:** Inter 400, 500, 600, 700 · JetBrains Mono 400, 500.
Do not bundle italics or other weights. Faux-bold and faux-italic are forbidden — if a weight is not bundled, it may not be used.

### Numerals

Inter's **tabular figures** (`FontFeature.tabularFigures()` in Flutter, `font-variant-numeric: tabular-nums` on web) are **mandatory** for:
file sizes, storage counters, upload percentages, transfer speeds, durations, dates in tables, API
request counts, and every chart axis. Proportional figures cause column jitter as values update
during upload — this is a visible defect, not a preference.

---

## 2. Type Scale

Sizes are in logical pixels (CSS px on web). Line height is expressed absolutely (Flutter `height` = lineHeight ÷ fontSize).

| Token | Size | Line height | Weight | Letter spacing | Used for |
|-------|------|-------------|--------|----------------|----------|
| `display` | 32 | 40 | 600 | -0.02em | Marketing/empty-state hero, storage total on Storage screen |
| `h1` | 24 | 32 | 600 | -0.01em | Screen titles ("My Files", "Developer API") |
| `h2` | 20 | 28 | 600 | -0.01em | Section headers ("Recent", "API Keys") |
| `h3` | 18 | 26 | 600 | 0 | Card headers, dialog titles |
| `title` | 16 | 24 | 500 | 0 | Filenames, list item primary text, plan names |
| `body` | 14 | 20 | 400 | 0 | Default body, table cells, descriptions |
| `bodyStrong` | 14 | 20 | 600 | 0 | Emphasis inside body text |
| `bodySmall` | 13 | 18 | 400 | 0 | Secondary metadata, helper text |
| `label` | 13 | 18 | 500 | 0 | Buttons, tabs, form labels, chips |
| `caption` | 12 | 16 | 400 | 0.01em | Timestamps, file sizes, counts, badges |
| `overline` | 11 | 16 | 600 | 0.06em | ALL-CAPS group headers ("TODAY", "ACCOUNT") |
| `code` | 13 | 20 | 400 | 0 | JetBrains Mono — API keys, endpoints, IDs |
| `codeSmall` | 12 | 18 | 400 | 0 | JetBrains Mono — inline code in tables |

`caption` (12px) is the **smallest permitted text size**. Nothing smaller ships, on any platform.

### Mobile adjustments

The scale is shared across platforms with three exceptions:

| Token | Web | Mobile | Reason |
|-------|-------------|--------|--------|
| `h1` | 24/32 | 22/30 | narrow viewports |
| `display` | 32/40 | 28/36 | narrow viewports |
| `body` | 14/20 | 15/22 | thumb-distance reading; iOS/Android baseline is 15–17px |

Everything else is identical. Do not introduce further per-platform sizes.

---

## 3. Text Scaling (user accessibility setting)

CloudCols honors OS text scaling and **must not clip**.

- Clamp `textScaler` to **0.85–1.60**. Below 0.85 the UI becomes unreadable; above 1.60 file-manager density collapses beyond repair.
- Above 1.30, list items switch from fixed height to intrinsic height and secondary metadata lines wrap instead of truncating.
- Above 1.30, the web table view is permitted to fall back to list view.
- Buttons and inputs grow with text; they never clip their label.
- Test every screen at 0.85, 1.0, 1.3, and 1.6.

---

## 4. Truncation and Overflow

Filenames are user-controlled and can be extremely long. Rules:

| Context | Behavior |
|---------|----------|
| File list item | 1 line, `TextOverflow.ellipsis` **in the middle** so the extension stays visible: `My Very Long Holiday Ph….jpg` |
| Grid card | 2 lines max, ellipsis at end, extension shown in the type chip instead |
| File details panel | Full name, wrapped, selectable |
| Breadcrumb | Collapse middle segments to `…` — first and last segment always visible |
| Dialog title | 1 line, ellipsis; full name repeated in the body |
| Toast | 1 line, ellipsis |

Middle-ellipsis is a shared helper (`FilenameText`), not re-implemented per screen.

Every truncated string must expose the full value: a tooltip on web, long-press preview on mobile, and an accessible name carrying the untruncated text (`Semantics` in Flutter, `aria-label`/`title` on web).

---

## 5. Internationalization

- Never assume text width. Every label must survive ~2.5× expansion (German/Bengali compounds).
- No text baked into images or icons.
- Use `Directionality` correctly; do not hardcode `EdgeInsets.only(left:)` for text-adjacent spacing — use `start`/`end`.
- Inter covers Latin, Greek, Cyrillic. **Bengali, Arabic, CJK are not covered** — when those locales are added, a per-script fallback family must be registered in `fontFamilyFallback`. Note this in the localization ticket; do not assume Inter will render them.
- Numbers, dates, and file sizes go through `intl` formatting, never string concatenation.

---

## 6. Content Style Rules

- **Sentence case** for buttons, labels, menu items, and headings. Not Title Case, not ALL CAPS (except `overline`).
- File sizes: `2.4 MB`, `1.2 GB` — one decimal, binary-derived but decimal-labelled, space before unit, tabular figures.
- Dates: relative within 7 days ("2 hours ago", "Yesterday"), absolute beyond ("27 Aug 2026"). Absolute timestamps always in tooltips and always in Details, Trash, and audit/API logs.
- Errors state what happened and what to do next: "Upload failed — check your connection and retry", never "Error 500".
- Never surface internal identifiers, object keys, bucket names, or stack traces in user-facing text.

---

## 7. Implementation Contract

Generated from `design/tokens.json` into both clients.

| | Flutter (`cloudcols-app`) | Web (`cloudcols-web`) |
|---|---|---|
| Output | `lib/design/tokens/app_typography.dart` — `ThemeExtension<AppText>` | Tailwind `fontSize` / `fontFamily` theme + CSS variables |
| Framework binding | Material `TextTheme` populated from `AppText` | Tailwind typography classes |
| Font delivery | Bundled in `assets/fonts/` | `next/font` self-hosted, `font-display: swap` |
| Middle-ellipsis helper | `lib/design/widgets/filename_text.dart` | `<FilenameText>` component |

- Color is **never** baked into a type token — callers apply a color token from [COLORS.md](COLORS.md).
- Tabular figures are applied inside the token for `caption`, `body`, `code`, and every numeric style
  (`FontFeature.tabularFigures()` in Flutter; `font-variant-numeric: tabular-nums` on web).
- **Web self-hosts fonts via `next/font`** rather than loading from a third-party CDN — avoids a
  render-blocking external request and keeps the CSP tight.

## 8. Cross-references

- Color tokens → [COLORS.md](COLORS.md)
- Spacing, radii, breakpoints → [SPACING.md](SPACING.md)
- Per-component type assignments → [COMPONENTS.md](COMPONENTS.md)
