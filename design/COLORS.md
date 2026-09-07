# CloudCols — Color System

**Status:** Approved 2026-08-28 · **Owner:** this file is the single source of truth for every color value in CloudCols.

Approved direction: **Indigo + Cyan**. No other palette may be introduced.

> **Rule:** No hex literal may appear in either client outside its generated token layer.
> Flutter consumes `AppColors` via `Theme.of(context)`; web consumes CSS variables or Tailwind token
> classes. A raw hex — or an arbitrary Tailwind value like `text-[#4F46E5]` — is a build-blocking
> review failure. Values originate in `design/tokens.json`; see §6.

---

## 1. Brand Ramps

These are **primitives**. Widgets never reference them directly — they exist only to define the semantic tokens in section 2.

### Indigo (brand)

| Step | Hex | Used for |
|------|-----|----------|
| 50 | `#EEF2FF` | light selected row |
| 100 | `#E0E7FF` | light primaryContainer |
| 200 | `#C7D2FE` | light chart tint |
| 300 | `#A5B4FC` | dark onPrimaryContainer |
| 400 | `#818CF8` | dark link / focus ring |
| 500 | `#6366F1` | chart series 1 |
| 600 | `#4F46E5` | **light primary** |
| 700 | `#4338CA` | light primary hover |
| 800 | `#3730A3` | light primary pressed, light onPrimaryContainer |
| 900 | `#312E81` | deep accents |
| 950 | `#1E1B4B` | dark primaryContainer, dark selected row |

Dark-theme primary fill is `#5B54E8` (between 600 and 500) — chosen because it is the only value that
clears **both** 4.5:1 against white label text and 3:1 against the dark background.

### Cyan (accent)

| Step | Hex | Used for |
|------|-----|----------|
| 100 | `#CFFAFE` | light infoContainer |
| 300 | `#67E8F9` | dark onInfoContainer |
| 400 | `#22D3EE` | **dark accent / dark info** |
| 500 | `#06B6D4` | **light accent (fill and graphics only)** |
| 700 | `#0E7490` | **light info / accent-as-text** |
| 800 | `#155E75` | deep accent |
| 900 | `#164E63` | light onInfoContainer |

> **Critical accent rule:** `#06B6D4` on white is **2.43:1** — it fails AA badly.
> Cyan 500 is permitted **only** as a fill, icon-on-dark, chart mark, or progress track.
> When cyan must be *text* on a light background, use `#0E7490` (`accentText`). This is enforced in review.

### Neutral (slate — cool, tuned to the indigo)

`#FFFFFF` `#F8FAFC` `#F1F5F9` `#E2E8F0` `#CBD5E1` `#94A3B8` `#64748B` `#475569` `#334155` `#1E293B` `#0F172A` `#020617`

Dark-theme surfaces are **not** slate — they are custom, slightly indigo-tinted so the brand color
sits in the same family as the background instead of vibrating against a neutral grey:

`#0B0D14` `#141824` `#1C2130` `#232939` `#262C3D` `#333B52` `#5A6683` `#8494AC`

---

## 2. Semantic Tokens

This table is the contract. Both clients expose exactly these names, no more — `AppColors.<token>` in Flutter, `--color-<token>` / `bg-<token>` on web.

| Token | Light | Dark | Notes |
|-------|-------|------|-------|
| `background` | `#FFFFFF` | `#0B0D14` | app canvas |
| `surface` | `#F8FAFC` | `#141824` | cards, sidebar, sheets |
| `surfaceSubtle` | `#F1F5F9` | `#1C2130` | table header, inset panels |
| `elevatedSurface` | `#FFFFFF` | `#1C2130` | dialogs, menus, popovers |
| `surfaceOverlay` | `#FFFFFF` | `#232939` | topmost layer (toast, tooltip) |
| `border` | `#E2E8F0` | `#262C3D` | decorative dividers only |
| `borderStrong` | `#CBD5E1` | `#333B52` | card outline, table rules |
| `borderInteractive` | `#767F8C` | `#5A6683` | **input/checkbox/switch outlines — meets 3:1** |
| `primary` | `#4F46E5` | `#5B54E8` | primary fill |
| `primaryHover` | `#4338CA` | `#6366F1` | |
| `primaryPressed` | `#3730A3` | `#4F46E5` | |
| `primaryForeground` | `#FFFFFF` | `#FFFFFF` | label on primary fill |
| `primaryContainer` | `#E0E7FF` | `#1E1B4B` | tinted primary surface |
| `onPrimaryContainer` | `#3730A3` | `#A5B4FC` | |
| `link` | `#4F46E5` | `#818CF8` | primary used as text |
| `accent` | `#06B6D4` | `#22D3EE` | **fill/graphic only in light** |
| `accentText` | `#0E7490` | `#22D3EE` | cyan when it must be text |
| `textPrimary` | `#0F172A` | `#F1F5F9` | |
| `textSecondary` | `#475569` | `#94A3B8` | |
| `textMuted` | `#64748B` | `#8494AC` | smallest permitted text color |
| `textOnMedia` | `#FFFFFF` | `#FFFFFF` | always over a scrim, never bare |
| `success` | `#15803D` | `#4ADE80` | |
| `successContainer` | `#DCFCE7` | `#0F2A1B` | |
| `onSuccessContainer` | `#14532D` | `#86EFAC` | |
| `warning` | `#B45309` | `#FBBF24` | |
| `warningContainer` | `#FEF3C7` | `#2B1E06` | |
| `onWarningContainer` | `#78350F` | `#FCD34D` | |
| `error` | `#DC2626` | `#F87171` | |
| `errorContainer` | `#FEE2E2` | `#2C1315` | |
| `onErrorContainer` | `#7F1D1D` | `#FCA5A5` | |
| `info` | `#0E7490` | `#22D3EE` | |
| `infoContainer` | `#CFFAFE` | `#08252C` | |
| `onInfoContainer` | `#164E63` | `#67E8F9` | |
| `stateHover` | `#F1F5F9` | `#1C2130` | row/list hover |
| `stateSelected` | `#EEF2FF` | `#1E1B4B` | selected file row |
| `statePressed` | `#E2E8F0` | `#232939` | |
| `stateDisabledSurface` | `#F1F5F9` | `#1C2130` | |
| `stateDisabledContent` | `#94A3B8` | `#5A6683` | exempt from contrast minimums |
| `focusRing` | `#4F46E5` | `#818CF8` | 2px ring + 2px offset |
| `overlayScrim` | `#0F172A` @ 45% | `#000000` @ 60% | behind dialogs/sheets |
| `mediaScrim` | `#000000` @ 55% | `#000000` @ 55% | behind text on thumbnails |
| `skeletonBase` | `#F1F5F9` | `#1C2130` | |
| `skeletonHighlight` | `#F8FAFC` | `#232939` | |

### Dark mode is not an inversion

`surface` is **lighter** than `background` in dark (`#141824` > `#0B0D14`) and **darker** than
`background` in light (`#F8FAFC` < `#FFFFFF`). Elevation raises luminance in dark and lowers it in
light. Never derive one theme from the other programmatically.

---

## 3. File-Type Colors

Used for file-type icon chips. **Never the only signal** — every chip pairs the color with a distinct glyph, and the type is always available as text.

| Category | Light | Dark | Container (light / dark) |
|----------|-------|------|--------------------------|
| Image | `#7C3AED` | `#C4B5FD` | `#F3E8FF` / `#241A3D` |
| Video | `#DC2626` | `#FCA5A5` | `#FEE2E2` / `#2C1315` |
| Audio | `#DB2777` | `#F9A8D4` | `#FCE7F3` / `#2E1122` |
| PDF | `#B91C1C` | `#F87171` | `#FEE2E2` / `#2C1315` |
| Document | `#1D4ED8` | `#93C5FD` | `#DBEAFE` / `#0E1A33` |
| Spreadsheet | `#15803D` | `#86EFAC` | `#DCFCE7` / `#0F2A1B` |
| Archive | `#B45309` | `#FCD34D` | `#FEF3C7` / `#2B1E06` |
| Code | `#0E7490` | `#67E8F9` | `#CFFAFE` / `#08252C` |
| Folder | `#4F46E5` | `#818CF8` | `#E0E7FF` / `#1E1B4B` |
| Other | `#475569` | `#94A3B8` | `#F1F5F9` / `#1C2130` |

---

## 4. Storage and Data-Visualization Colors

### Storage ring / usage bar — by fill level

| Level | Track color | Meaning |
|-------|-------------|---------|
| 0–74% | `primary` | normal |
| 75–89% | `warning` | approaching limit |
| 90–99% | `error` | critical |
| 100%+ | `error` + lock icon + text | quota exceeded |

Level **must** also change the accompanying label text ("12.4 GB of 20 GB used" → "Storage almost full"), never color alone.

### Category breakdown series

Ordered, colorblind-checked, used for the storage donut and category bars — reuses the file-type colors above in this fixed order: Image, Video, Document, PDF, Audio, Archive, Other.

### API usage charts

| Series | Light | Dark |
|--------|-------|------|
| Successful requests | `#4F46E5` | `#818CF8` |
| Failed (4xx) | `#B45309` | `#FBBF24` |
| Failed (5xx) | `#DC2626` | `#F87171` |
| Rate limited | `#0E7490` | `#22D3EE` |
| Grid lines | `#E2E8F0` | `#262C3D` |
| Axis labels | `#64748B` | `#8494AC` |

---

## 5. Accessibility Verification

Every pair below was computed with the WCAG 2.1 relative-luminance formula on 2026-08-28.
**37/37 pass.** Re-run and update this table whenever a value changes.

### Light theme

| Pair | Foreground | Background | Ratio | Required | Result |
|------|-----------|------------|-------|----------|--------|
| textPrimary on background | `#0F172A` | `#FFFFFF` | 17.85:1 | 4.5:1 | PASS |
| textPrimary on surface | `#0F172A` | `#F8FAFC` | 17.06:1 | 4.5:1 | PASS |
| textSecondary on background | `#475569` | `#FFFFFF` | 7.58:1 | 4.5:1 | PASS |
| textMuted on surface | `#64748B` | `#F8FAFC` | 4.55:1 | 4.5:1 | PASS |
| primaryForeground on primary | `#FFFFFF` | `#4F46E5` | 6.29:1 | 4.5:1 | PASS |
| primary as link text | `#4F46E5` | `#FFFFFF` | 6.29:1 | 4.5:1 | PASS |
| onPrimaryContainer on primaryContainer | `#3730A3` | `#E0E7FF` | 8.06:1 | 4.5:1 | PASS |
| success on background | `#15803D` | `#FFFFFF` | 5.02:1 | 4.5:1 | PASS |
| warning on background | `#B45309` | `#FFFFFF` | 5.02:1 | 4.5:1 | PASS |
| error on background | `#DC2626` | `#FFFFFF` | 4.83:1 | 4.5:1 | PASS |
| info on background | `#0E7490` | `#FFFFFF` | 5.36:1 | 4.5:1 | PASS |
| onSuccessContainer | `#14532D` | `#DCFCE7` | 8.30:1 | 4.5:1 | PASS |
| onWarningContainer | `#78350F` | `#FEF3C7` | 8.15:1 | 4.5:1 | PASS |
| onErrorContainer | `#7F1D1D` | `#FEE2E2` | 8.20:1 | 4.5:1 | PASS |
| onInfoContainer | `#164E63` | `#CFFAFE` | 8.14:1 | 4.5:1 | PASS |
| textPrimary on stateSelected | `#0F172A` | `#EEF2FF` | 15.97:1 | 4.5:1 | PASS |
| borderInteractive on background | `#767F8C` | `#FFFFFF` | 4.05:1 | 3.0:1 | PASS |
| focusRing on background | `#4F46E5` | `#FFFFFF` | 6.29:1 | 3.0:1 | PASS |

18/18 pass.

### Dark theme

| Pair | Foreground | Background | Ratio | Required | Result |
|------|-----------|------------|-------|----------|--------|
| textPrimary on background | `#F1F5F9` | `#0B0D14` | 17.72:1 | 4.5:1 | PASS |
| textPrimary on surface | `#F1F5F9` | `#141824` | 16.16:1 | 4.5:1 | PASS |
| textSecondary on background | `#94A3B8` | `#0B0D14` | 7.57:1 | 4.5:1 | PASS |
| textMuted on elevatedSurface | `#8494AC` | `#1C2130` | 5.20:1 | 4.5:1 | PASS |
| primaryForeground on primary | `#FFFFFF` | `#5B54E8` | 5.41:1 | 4.5:1 | PASS |
| primary as link text | `#818CF8` | `#0B0D14` | 6.51:1 | 4.5:1 | PASS |
| onPrimaryContainer on primaryContainer | `#A5B4FC` | `#1E1B4B` | 8.02:1 | 4.5:1 | PASS |
| success on background | `#4ADE80` | `#0B0D14` | 11.14:1 | 4.5:1 | PASS |
| warning on background | `#FBBF24` | `#0B0D14` | 11.63:1 | 4.5:1 | PASS |
| error on background | `#F87171` | `#0B0D14` | 7.02:1 | 4.5:1 | PASS |
| info on background | `#22D3EE` | `#0B0D14` | 10.74:1 | 4.5:1 | PASS |
| onSuccessContainer | `#86EFAC` | `#0F2A1B` | 10.94:1 | 4.5:1 | PASS |
| onWarningContainer | `#FCD34D` | `#2B1E06` | 11.28:1 | 4.5:1 | PASS |
| onErrorContainer | `#FCA5A5` | `#2C1315` | 9.14:1 | 4.5:1 | PASS |
| onInfoContainer | `#67E8F9` | `#08252C` | 11.05:1 | 4.5:1 | PASS |
| textPrimary on stateSelected | `#F1F5F9` | `#1E1B4B` | 14.59:1 | 4.5:1 | PASS |
| borderInteractive on background | `#5A6683` | `#0B0D14` | 3.39:1 | 3.0:1 | PASS |
| focusRing on background | `#818CF8` | `#0B0D14` | 6.51:1 | 3.0:1 | PASS |
| primary fill on background | `#5B54E8` | `#0B0D14` | 3.58:1 | 3.0:1 | PASS |

19/19 pass.

### Known contrast exemptions (deliberate, WCAG-permitted)

- `border` / `borderStrong` are decorative dividers and do **not** meet 3:1. Any border that
  *identifies an interactive control* must use `borderInteractive` instead.
- `stateDisabledContent` is exempt under WCAG 1.4.3 (disabled controls).
- `accent` light (`#06B6D4`, 2.43:1) is fill-only — see the critical accent rule in section 1.

### Rules

- Body text ≥ 4.5:1. Text ≥ 18.66px bold or ≥ 24px may use 3:1, but CloudCols does not take this exemption.
- Interactive borders, focus rings, and icon-only controls ≥ 3:1.
- Status is **never** communicated by color alone — always color + icon + text.
- Text over a thumbnail always sits on `mediaScrim`, never directly on the image.

---

## 6. Implementation Contract

These values live in `design/tokens.json` and are **generated** into both clients. Never hand-write
a color in either codebase.

| | Flutter (`cloudcols-app`) | Web (`cloudcols-web`) |
|---|---|---|
| Output | `lib/design/tokens/app_colors.dart` — `ThemeExtension<AppColors>` | `globals.css` custom properties + `tailwind.config.ts` |
| Access | `Theme.of(context).extension<AppColors>()!` | `var(--color-…)` or the Tailwind token class |
| Framework binding | Material `ColorScheme` populated from tokens | Tailwind theme extended from tokens |
| System theme | `MediaQuery.platformBrightness` | `prefers-color-scheme`, overridable via `[data-theme]` |

- The user's explicit choice in Settings → Appearance overrides the system preference in both clients.
- Theme changes must not drop scroll position, selection, or in-flight transfers.
- Web must resolve the theme before first paint — no flash of the wrong theme.

## 7. Cross-references

- Type ramp and font stack → [TYPOGRAPHY.md](TYPOGRAPHY.md)
- Spacing, radii, elevation, motion, breakpoints → [SPACING.md](SPACING.md)
- Which token each component uses in each state → [COMPONENTS.md](COMPONENTS.md)
