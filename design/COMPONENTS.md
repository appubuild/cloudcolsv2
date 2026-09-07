# CloudCols — Component Library

**Status:** Approved 2026-08-28 · **Canonical component inventory.** This file resolves all naming conflicts between the skill documents.

> **Rule:** Before creating any component in **either client**, search this file. If it exists, use or
> extend it. If it does not, add it here first with its states, then implement. A component that ships
> without an entry here is a review failure.

## Shared contract, two implementations

A component name means the same **behavior, states, and semantics** in both clients. Only the
technology differs — there is no shared code.

| | Flutter (`cloudcols-app`) | Web (`cloudcols-web`) |
|---|---|---|
| Location | `lib/design/widgets/` (primitives), `lib/features/<feature>/widgets/` | `src/components/ui/` (primitives), `src/features/<feature>/components/` |
| Naming | `FileCard` (Dart class) | `FileCard` (React component) |
| Base | Material widgets styled from tokens | Headless primitives styled from tokens |
| Owner skill | `ui-engineer` | `web-engineer` |

If a component's behavior changes, update **this file** so both clients change together. Changing one
implementation without the other is how the two products drift apart.

### Web-only components
These exist only in `cloudcols-web` and must never be built in Flutter
(`product-planner` invariant 10):
`ApiUsageCard` · `ApiUsageChart` · `ApiKeyCard` · `ApiKeyCreateDialog` · `WebhookCard` ·
`WebhookDeliveryList` · `DocsNav` · `CodeBlock` · `ScopeSelector` · all admin-panel components ·
`PublicSharePage`.

### Mobile-only components
`AppBottomNav` · `AudioMiniPlayer` (web uses a docked player) · `UploadSourceSheet` (mobile variant).

---

## 0. Naming Authority

The skills and the original design briefs used different names for the same components.
**The names in this file win**, in both clients. Superseded aliases:

| Alias used elsewhere | Canonical name |
|----------------------|----------------|
| `MobileBottomNavigation`, `BottomNavigation` | `AppBottomNav` |
| `DesktopSidebar` | `AppSidebar` (web) |
| `AppBar` | `AppTopBar` (web) / `AppMobileBar` (mobile) |
| `Toast`, `Snackbar` | `AppToast` |
| `TransferProgress` | `TransferProgressBar` |
| `UploadItem`, `UploadProgressItem` | `TransferQueueItem` (shared by upload + download) |
| `UploadQueue`, `DownloadQueue` | `TransferQueuePanel` (one component, two modes) |
| `FilePropertiesDialog`, `FileDetailsPanel` | `FileDetailsView` (panel on web, sheet on mobile) |
| `ContextMenu`, `OverflowMenu` | `AppMenu` (popup on web, bottom sheet on mobile) |
| `FilterSheet`, `FilterBar` | `FilterControl` (bar on web, sheet on mobile) |
| `ShareSheet` | `ShareView` |
| `DocumentationNavigation` | `DocsNav` |

**Adaptive-by-default principle:** within a single client, differing presentations of one concept are
**one component with a responsive body**, not two components. Across clients, the same name means the
same contract — see "Shared contract, two implementations" above.

---

## 1. Universal State Contract

Every interactive component must implement all applicable states. Missing states are the single most
common defect in this product area.

`default` · `hover` (pointer only) · `focus` (visible ring, `focusRing` token) · `pressed` ·
`selected` · `disabled` · `loading` · `error`

Every data-bearing view must implement: `loading` (skeleton) · `empty` · `error` · `offline` ·
`permissionDenied` · `quotaExceeded` (where transfers are involved).

State visuals come from [COLORS.md](COLORS.md) §2 (`stateHover`, `stateSelected`, `statePressed`, `stateDisabled*`, `focusRing`).

---

## 2. Navigation

| Component | Spec |
|-----------|------|
| `AppShell` | Owns the responsive frame. Chooses sidebar / rail / bottom nav from `AppBreakpoint`. Hosts `TransferQueuePanel`, `AudioMiniPlayer`, `AppToast` host, and the offline banner. Preserves per-tab navigation stack and scroll position. |
| `AppSidebar` | Web only. 256 expanded / 72 collapsed. Sections: Main (Dashboard, My Files, Recent, Favorites, Shared, Trash) · Categories (Images, Videos, Documents, PDF, Audio) · Account (Storage, Developer API) · Footer (Settings, Help). Collapsed shows icon + tooltip. Active route: `primaryContainer` fill + `primary` left bar + `onPrimaryContainer` label. Storage mini-indicator pinned at the bottom. |
| `AppNavRail` | Web, `md` breakpoint only. Icons + short labels, 72 wide. |
| `AppBottomNav` | Mobile only. 5 tabs: **Home · Files · Media · Shared · Profile**. 64 + safe area. Active = filled icon + `primary` label; inactive = outline icon + `textSecondary`. Badge support on Profile (notifications). Re-tapping the active tab pops to root, then scrolls to top. |
| `AppTopBar` | 60px. Left: logo + collapse toggle. Center: `SearchBar`. Right: upload, notifications, help, avatar menu. |
| `AppMobileBar` | 56px. Title, optional back, up to 2 actions + overflow. Collapses to a search field in search mode. |
| `Breadcrumbs` | Middle-collapsing with `…`. First and last segment always visible. Each segment is a drop target for move-by-drag. Mobile: horizontally scrollable, last segment bold. |
| `AppTabs` | Underline indicator, `label` type, scrollable when overflowing. |

---

## 3. File Management

| Component | Spec |
|-----------|------|
| `FileCard` | Grid cell 180×200 web / 4:5 mobile. `MediaThumbnail` top, name (2 lines, `title`), size + date (`caption`), favorite star overlay, selection checkbox on hover/selection mode, `AppMenu` trigger. |
| `FileListItem` | Row 44 web / 56 mobile. Thumbnail 32/40, `FilenameText`, metadata line, favorite, menu trigger. Selected = `stateSelected` + left `primary` bar. |
| `FileTableRow` | Web `lg`+ only. Columns: Name, Type, Size, Modified, Location, Actions. Sortable headers, resizable, sticky header. |
| `FolderCard` / `FolderListItem` | Folder glyph in `Folder` file-type color, item count, no thumbnail. Valid drop target. |
| `MediaThumbnail` | Loads the **thumbnail variant only** — never full-resolution. Placeholder → fade in (`base`). Video overlay: duration pill bottom-right on `mediaScrim`. Error → file-type glyph, never a broken image. |
| `FileTypeChip` | Color + distinct glyph + text label. Colors from [COLORS.md](COLORS.md) §3. |
| `SelectionToolbar` | Replaces the top bar in selection mode. Shows count, Share, Download, Move, Delete, overflow, Clear. Mobile: bottom bar above nav. |
| `FileDetailsView` | Web: 360 right panel. Mobile: bottom sheet. Sections: preview, name, type, size, location, created, modified, owner, sharing status, favorite. Media adds dimensions/duration/MIME. Actions row at the bottom. |
| `AppMenu` | Web: popup at cursor, keyboard navigable, stays in viewport. Mobile: bottom sheet with the same items. Canonical file action order: **Open · Preview · Download · Share · Rename · Move · Copy · Favorite · Details · —— · Delete** (destructive last, separated, `error` colored). |
| `EmptyFolderDropZone` | Full-area dashed `borderInteractive` outline on drag-over. |

---

## 4. Actions and Input

| Component | Spec |
|-----------|------|
| `PrimaryButton` | `primary` fill, `primaryForeground` label, 40/48 high, `radiusSm`. Loading = inline spinner replacing the label, width locked, button disabled. Prevents double submit. |
| `SecondaryButton` | `borderInteractive` outline, transparent fill, `textPrimary` label. |
| `GhostButton` | No border, `stateHover` on hover. |
| `DestructiveButton` | `error` fill / `error` outline variant. Used only for irreversible actions. |
| `AppIconButton` | 40/48 hit area, 20/24 glyph. **Tooltip required** on web; accessible name always (`aria-label` on web, `Semantics` in Flutter). |
| `SearchBar` | 36 in web header / 44 mobile. Leading search glyph, clear button when non-empty, 300ms debounce, inline spinner while querying. `Cmd/Ctrl+K` focuses it. |
| `FilterControl` | Web: inline chip bar with active state + Clear all. Mobile: bottom sheet. Filters: Type, Date, Size, Location, Shared, Favorite. |
| `SortMenu` | Field (Name, Date, Size, Type) + direction. Shows current selection. |
| `AppTextField` | 40/48, `radiusSm`, `borderInteractive` outline, `primary` 2px on focus, `error` + message below on invalid. Label above, helper text below, both reserving space so layout does not shift. |
| `AppSelect` / `AppCheckbox` / `AppRadio` / `AppSwitch` | Standard, `borderInteractive` outlines, `focusRing` on focus. |
| `AppSegmentedControl` | Grid/List view switcher, time-range switcher. |

---

## 5. Feedback

| Component | Spec |
|-----------|------|
| `AppToast` | Bottom-center on web / above bottom nav on mobile. 4s default, 8s with an action. Max 3 stacked. Optional Undo/Retry. **Never** used for errors that need a decision. |
| `ConfirmDialog` | Title, body naming the affected items, Cancel + confirm. Destructive variant uses `DestructiveButton`. Permanent deletion requires typed confirmation of the item count. |
| `AppBottomSheet` | `radiusXl` top, drag handle, max 90% height, scrollable body, safe-area bottom padding. |
| `AppDialog` | 480/640/800 max width, `radiusLg`, `e4`, scrim, Escape/back to close, focus trapped, first field autofocused. |
| `EmptyState` | Glyph + `h3` headline + `body` explanation + primary action. One per list — see §11 for the required set. |
| `ErrorState` | Glyph + what happened + what to do + Retry. Never shows a stack trace, error code, or internal identifier. |
| `OfflineBanner` | Full-width `warningContainer` strip at z=110. Persists while offline, auto-dismisses on reconnect with a `success` toast. |
| `LoadingState` / `Skeleton` | Skeletons mirror the real layout (row heights, column widths). 1200ms shimmer, static under reduced motion. Spinner only for actions under ~1s. |
| `AppProgressBar` / `AppProgressRing` | Determinate wherever a real percentage exists. **Fake or simulated progress is forbidden.** Indeterminate only when the total is genuinely unknown. |

---

## 6. Transfers

| Component | Spec |
|-----------|------|
| `TransferQueuePanel` | One component, `mode: upload \| download`. Web: dockable 400×320 bottom-right, collapsible to a summary bar, z=50. Mobile: bottom sheet + persistent progress in the nav badge. Header: "Uploading 3 of 7 · 42%", Pause all / Cancel all. Survives navigation. |
| `TransferQueueItem` | Thumbnail, `FilenameText`, size, `TransferProgressBar`, percentage, speed, ETA, per-item Pause/Resume/Cancel/Retry. |
| `TransferProgressBar` | 4px, `radiusPill`, `primary` fill. Turns `warning` when paused, `error` on failure. |
| `TransferStatusChip` | Preparing · Waiting · Uploading · Paused · Completed · Failed · Cancelled · Retrying · Quota exceeded · Offline · Permission denied. Icon + text, never color alone. |
| `UploadSourceSheet` | Mobile: Files, Photos, Videos, Documents, Camera (where available). Web: Upload files / Upload folder dropdown. |
| `DropZoneOverlay` | Web only. Full-window `primaryContainer` tint + dashed `primary` outline on drag-enter. Suppresses default browser navigation. |

Speed and ETA render only when the measurement is stable (≥3s of samples); otherwise the slot shows "—" rather than a jittering number.

---

## 7. Media

| Component | Spec |
|-----------|------|
| `ImageViewer` | Fullscreen, `overlayScrim`. Pinch/double-tap zoom, pan, swipe between items, arrow-key navigation, Escape to close. Chrome auto-hides after 3s, returns on tap. Actions: Favorite, Share, Download, Delete, Details, Rotate. |
| `VideoPlayer` | Poster → play. Play/pause, seek with buffered range, volume, fullscreen, playback speed, PiP where supported, control lock (mobile). **Streams via range requests — never downloads fully before playback.** Buffering, error, and expired-URL recovery states required. |
| `AudioMiniPlayer` | Persistent bar, z=55, above bottom nav. Icon, `FilenameText`, play/pause. Tap expands. |
| `AudioPlayerExpanded` | Artwork/glyph, name, scrubber, play/pause, previous/next, speed. |
| `PdfViewer` | Page navigation, page indicator, zoom, fit-width, search where supported, fullscreen, download, share, print (web). |
| `UnsupportedPreview` | File-type glyph, name, size, type, and a clear Download / Open externally action. Never a broken preview frame. |
| `MediaControls` | Shared control cluster used by video and audio; `textOnMedia` over `mediaScrim`. |

---

## 8. Storage and Plans

| Component | Spec |
|-----------|------|
| `StorageUsageCard` | `AppProgressRing` or bar, "12.4 GB of 20 GB used", remaining, percentage. Ring color follows the level table in [COLORS.md](COLORS.md) §4 **and** the label text changes with it. Upgrade CTA. |
| `StorageCategoryCard` | Donut + legend: Images, Videos, Documents, PDF, Audio, Archive, Other. Legend shows size and percentage. |
| `LargestFilesList` | Top N by size with a direct action to open or delete. |
| `PlanCard` | Name, capacity, price + interval, feature list, CTA. Current plan is marked and its CTA disabled. **All values come from the server** — no hardcoded prices or quotas. |
| `UpgradePrompt` | Inline card shown to free users; hidden entirely for paid users. |
| `UsageWarning` | Appears at 75%/90%/100%. Explains the consequence and links to Upgrade. |
| `AdSlot` | Renders only when the server says ads are enabled for this account. Reserves its height to prevent layout shift, and is **never** placed in upload, download, preview, or payment flows. Renders nothing (zero height) for paid users. |

---

## 9. Developer / API

| Component | Spec |
|-----------|------|
| `ApiUsageCard` | Requests, success rate, errors, rate-limit events, remaining quota. |
| `ApiUsageChart` | Time series, ranges Today / 7d / 30d / custom. Series colors from [COLORS.md](COLORS.md) §4. Aggregated server-side. |
| `ApiKeyCard` | Name, created, last used, status, scopes, Revoke / Rotate. **Displays a masked prefix only** (`sk_live_a1B2…`), never the full secret. |
| `ApiKeyCreateDialog` | Name + scope checkboxes. On success shows the secret **once**, with copy button and an explicit warning. Leaving the dialog destroys it client-side; it is never re-displayable. |
| `WebhookCard` | Endpoint, events, status, last delivery, success rate, Test, Edit, Delete. |
| `WebhookDeliveryList` | Timestamp, event, response code, duration, retry count, Retry action. |
| `DocsNav` | Left navigation for the developer documentation. |
| `CodeBlock` | JetBrains Mono, language tabs (cURL / JavaScript / Python / Dart), copy button, horizontal scroll, syntax highlighting. Never wraps. |
| `ScopeSelector` | Checkbox list of `files.read`, `files.write`, `files.delete`, `folders.read`, `folders.write`, `share.create`, `webhook.manage`, each with a plain-language description. |

---

## 10. Sharing

| Component | Spec |
|-----------|------|
| `ShareView` | Sheet on mobile, dialog on web. Current state (Private / Link accessible / Expired / Revoked), permission (View / View + Download), expiration, optional password, generated link + Copy, native share, Revoke. |
| `ShareStatusBadge` | Private · Shared · Link accessible · Expired · Revoked. Icon + text. |
| `PublicSharePage` | **Web only, server-rendered.** Branding, filename, size, type, preview, download. Password prompt when protected. Clear expired/revoked states. **Must emit OpenGraph/Twitter meta tags server-side** — this is the surface Flutter Web could not provide. Exposes no internal identifiers or storage URLs. |

---

## 11. Required Empty States

Each needs a glyph, headline, one-line explanation, and a primary action.

| Screen | Headline | Action |
|--------|----------|--------|
| My Files (root) | No files yet | Upload files |
| Folder | This folder is empty | Upload files |
| Search | No results for "…" | Clear filters |
| Images / Videos / Audio / Documents / PDF | No {category} yet | Upload |
| Favorites | No favorites yet | Browse files |
| Shared | Nothing shared yet | Browse files |
| Trash | Trash is empty | — (informational) |
| Notifications | You are all caught up | — |
| API keys | No API keys yet | Create key |
| Webhooks | No webhooks yet | Create webhook |
| API usage | No API activity yet | View documentation |
| Transfers | No active transfers | — |

---

## 12. Required Error States

| Condition | Message intent | Action |
|-----------|----------------|--------|
| Offline | Connection lost, work is preserved | Retry |
| Session expired | Sign in again to continue | Sign in |
| Permission denied | You do not have access to this item | Go back |
| File not found | This file no longer exists | Go back |
| Quota exceeded | Not enough storage for this upload | Upgrade / Free up space |
| File too large | Exceeds the {n} GB limit | Choose another file |
| Invalid file type | This type is not allowed | Choose another file |
| Upload failed | Upload could not complete | Retry |
| Share expired | This link has expired | — |
| Rate limited | Too many requests, try again in {n}s | — |
| Server error | Something went wrong on our side | Retry |

Backend returns a machine-readable code (`QUOTA_EXCEEDED`, `RATE_LIMITED`, …); the UI maps it to a localized human message. The raw code never reaches the user.

---

## 13. Definition of Done (per component)

- [ ] Entry exists in this file
- [ ] All applicable states from §1 implemented
- [ ] Uses only tokens from COLORS / TYPOGRAPHY / SPACING
- [ ] Light, Dark, and System themes verified
- [ ] Responsive behavior verified at `xs`, `md`, and `lg`
- [ ] Keyboard reachable with a visible focus ring (web)
- [ ] Accessible name present (`Semantics` / `aria-label`); icon-only controls have tooltips on web
- [ ] Behavior matches the other client's implementation of the same component name
- [ ] Text scaling verified at 1.0 and 1.6
- [ ] Long-filename / long-label overflow verified
- [ ] No secrets, storage URLs, or internal identifiers rendered
- [ ] Widget test covering the primary state matrix
