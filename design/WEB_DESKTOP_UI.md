# CloudCols — Web UI

**Status:** Approved 2026-08-28 (Architecture v2) · Layout and screen specification for
**`cloudcols-web`** — Next.js + TypeScript on Cloudflare Workers.

> **Scope change (Architecture v2):** this document previously covered Flutter Web *and* Flutter
> Desktop. Flutter Web is gone — the web client is now Next.js. **Flutter Desktop is ON HOLD**;
> desktop is planned as a wrapper around this web app, see §4.
>
> File name retained as `WEB_DESKTOP_UI.md` to keep existing links valid.

`cloudcols-web` owns four products on one origin:

| Surface | Rendering | SEO |
|---------|-----------|-----|
| Public website (home, pricing, legal) | SSG | Critical |
| Public share pages `/s/:token` | **SSR** | Critical — OG cards |
| Developer documentation | SSG | Critical |
| User web app (file manager, preview, sharing) | CSR behind auth | `noindex` |
| **Developer portal** (dashboard, keys, webhooks) | CSR behind auth | `noindex` — **web-only** |
| **Admin panel** | CSR behind auth + server-side role gate | `noindex` — **web-only** |

Values referenced here are defined in [COLORS.md](COLORS.md), [TYPOGRAPHY.md](TYPOGRAPHY.md),
[SPACING.md](SPACING.md); components in [COMPONENTS.md](COMPONENTS.md). Implementation rules live in
the `web-engineer` skill.

---

## 1. Application Shell

```
┌─────────────────────────────────────────────────────────────┐
│ AppTopBar                                            60px   │
│ [logo] [collapse]      [ SearchBar ]   [upload][bell][?][av]│
├────────────┬────────────────────────────────────────────────┤
│ AppSidebar │  Content area                                  │
│   256px    │    padding xl (24)                             │
│            │    max-width 1600 at xxl, centered             │
│  ┌ MAIN    │  ┌──────────────────────────┬─────────────────┐│
│  │Dashboard│  │ Toolbar (breadcrumb,     │ FileDetailsView ││
│  │My Files │  │  view, sort, filter)     │   360px         ││
│  │Recent   │  ├──────────────────────────┤  (xl+ only)     ││
│  │Favorites│  │                          │                 ││
│  │Shared   │  │  File grid / list/ table │                 ││
│  │Trash    │  │                          │                 ││
│  ├ CATEGORY│  │                          │                 ││
│  │Images   │  └──────────────────────────┴─────────────────┘│
│  │Videos   │                                                │
│  │Documents│                       ┌───────────────────────┐│
│  │PDF      │                       │ TransferQueuePanel    ││
│  │Audio    │                       │   400x320  z=50       ││
│  ├ ACCOUNT │                       └───────────────────────┘│
│  │Storage  │                                                │
│  │Developer│                                                │
│  ├─────────│                                                │
│  │Settings │                                                │
│  │Help     │                                                │
│  │[storage]│                                                │
└────────────┴────────────────────────────────────────────────┘
```

### Responsive shell behavior

| Breakpoint | Shell |
|------------|-------|
| `xxl` ≥1920 | Sidebar 256 + content (max 1600) + details panel 360 |
| `xl` 1440–1919 | Sidebar 256 + content + details panel 360 |
| `lg` 1024–1439 | Sidebar 256 + content; details opens as an overlay panel |
| `md` 768–1023 | `AppNavRail` 72 + content; details as overlay |
| `sm` / `xs` <768 | Responsive mobile web layout — bottom nav, touch targets, sheets. This is the **browser on a phone**, not the Flutter app; both exist and must both work. |

Sidebar collapse state persists per user. Collapsed sidebar shows icons with tooltips and keeps the storage indicator as a bare ring.

---

## 2. Screen Specifications

For each screen: purpose · layout · components · states.

### Dashboard
- **Purpose:** orient the user and surface the two things they act on most — storage and recent files.
- **Layout:** greeting (`h1`, time-aware) · `StorageUsageCard` full width · quick actions row (Upload, New folder, Import, Share) · Recent files (8 items, horizontal on `lg`, grid on `xl`) · category tiles (Images/Videos/Documents/PDF/Audio with counts and sizes) · recent activity list · `UpgradePrompt` (free users only).
- **States:** skeleton on load; new-account empty state replaces recent/activity with an onboarding card; offline serves cached metadata with the offline banner.
- Deliberately not dense — this is an orientation screen, not a second file manager.

### My Files
- **Purpose:** the core file manager.
- **Toolbar:** back/forward · `Breadcrumbs` · spacer · Upload · New folder · view switcher (grid/list/table) · `SortMenu` · `FilterControl` · overflow.
- **Body:** grid (`FileCard`, columns per breakpoint) / list (`FileListItem`) / table (`FileTableRow`, `lg`+ only). Virtualized; pagination is infinite-scroll with a 60-item page.
- **Selection:** click selects, Ctrl/Cmd+click toggles, Shift+click ranges, Ctrl/Cmd+A selects all, Escape clears. `SelectionToolbar` replaces the toolbar.
- **Drag & drop:** files onto folders to move; files from OS into the window to upload; `DropZoneOverlay` on drag-enter; breadcrumb segments are drop targets; invalid targets show a no-drop cursor and never accept.
- **States:** skeleton grid, empty folder, no-search-results, offline (cached list, actions disabled with explanation), permission denied.

### Recent · Favorites · Shared · Trash
- Same file-manager body, different data source and toolbar.
- **Recent:** grouped Today / Yesterday / Earlier; shows last-accessed instead of modified.
- **Favorites:** tabs Files / Folders.
- **Shared:** shows `ShareStatusBadge`, access count, expiry; action to revoke.
- **Trash:** columns Deleted, Original location; actions Restore / Delete permanently; Empty trash in the toolbar with a typed-count confirmation; banner stating the retention period and that trashed files still consume quota.

### Category screens (Images, Videos, Documents, PDF, Audio)
- **Images:** gallery grid, larger thumbnails, optional grouping by date; opens `ImageViewer`.
- **Videos:** `FileCard` grid with duration pill and play affordance; opens `VideoPlayer` with a side info panel on `xl`.
- **Audio:** list view; plays into `AudioMiniPlayer` without leaving the screen.
- **Documents / PDF:** list view defaulted; PDF opens `PdfViewer`.

### Search
- Opens as an overlay from the top bar or `Cmd/Ctrl+K`.
- Empty query: recent searches + suggested filters. Typing: 300ms debounce, inline spinner, results grouped by type with a "Show all" per group.
- Advanced filters: Type, Date range, Size range, Location, Owner, Shared, Favorite. Active filters shown as removable chips with Clear all.
- States: idle, loading, results, no results (with Clear filters), error.

### Storage
- Large `AppProgressRing`, used / remaining / total, `StorageCategoryCard` donut, `LargestFilesList`, plan summary, upgrade CTA.

### Pricing / Upgrade
- `PlanCard` row: Free, 100 GB, 200 GB, 1 TB — **all fetched from the server**. Billing interval toggle. Current plan marked. Feature comparison table below. Restrictions stated plainly, never hidden.

### Developer / API portal
- Distinct sub-navigation (Overview, API Keys, Documentation, Usage, Webhooks, Plans, Settings) inside the same shell, so it reads as a separate product without becoming a separate app.
- **Overview:** `ApiUsageCard` row + `ApiUsageChart` + recent activity.
- **API Keys:** table + Create; `ApiKeyCreateDialog` shows the secret once.
- **Documentation:** `DocsNav` left, content center, `CodeBlock` with cURL / JavaScript / Python / Dart tabs.
- **Usage:** metrics with Today / 7d / 30d / custom ranges.
- **Webhooks:** list, create, test, delivery history.
- Storage subscription and API subscription are always visually separate — never merged into one billing card.

### Public website (SSG)
- **Home:** hero, value proposition, feature sections, plan summary, CTA. `display` type, `huge` spacing.
- **Pricing:** `PlanCard` row from server data, comparison table, FAQ.
- **Legal:** terms, privacy, data policy.
- Full metadata, structured data, sitemap entry. Target LCP under 2.5s.

### Public share page `/s/:token` (SSR)
- **The commercially important page.** Server-renders OpenGraph and Twitter card meta (title, file
  type, size, thumbnail) so pasting a link into a chat app produces a real preview. This is the
  single capability Flutter Web could not provide at all.
- Body: CloudCols branding, filename, type, size, preview (image/video/PDF/audio), Download.
- Password prompt when protected; distinct Expired and Revoked states.
- Authorization checked **server-side per request** — never cached publicly.
- Emits no internal identifier, object key, or signed URL into the HTML or embedded JSON.
- `noindex` on the token route; the OG tags are for link unfurling, not search.

### Developer documentation (SSG)
- `DocsNav` left, content center, on-this-page right at `xl`.
- `CodeBlock` with cURL / JavaScript / Python / Dart tabs.
- Fully indexable — developers arrive from search.

### Settings
- Two-pane: left section list, right content. Sections: Profile, Account, Security, Notifications, Appearance, Storage, Sharing, Developer API, Privacy.
- Every change saves explicitly (Save / Cancel) except toggles, which save immediately with a toast and an Undo where reversible.

### Admin panel
- Same shell, separate route tree, server-side role gate. Hiding the route is not the access control.
- Sections per the master plan: Dashboard, Users, Storage, Files, Plans, Subscriptions, Payments, Ads, Developer API, API Plans, API Usage, API Keys, Webhooks, Sharing, System Settings, Security, Notifications, Email Templates, Activity Logs, Reports, Maintenance, Feature Flags.
- High-impact actions require re-authentication and are written to the audit log.

---

## 3. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Focus search |
| `Cmd/Ctrl + U` | Upload files |
| `Cmd/Ctrl + Shift + N` | New folder |
| `Cmd/Ctrl + A` | Select all |
| `Cmd/Ctrl + C` / `V` | Copy / paste files |
| `F2` | Rename selected |
| `Delete` | Move to trash |
| `Shift + Delete` | Delete permanently (confirm) |
| `Enter` | Open / preview |
| `Space` | Quick preview |
| `Escape` | Close dialog, viewer, or clear selection |
| `←` `→` | Previous / next in media viewer |
| `Cmd/Ctrl + \` | Toggle sidebar |
| `?` | Shortcut reference |

Every shortcut has a visible mouse equivalent. Shortcuts are disabled while a text field has focus. A discoverable reference lives under Help.

---

## 4. Deferred: Desktop Wrapper

**Desktop is not in current scope.** Flutter Desktop is on hold; the plan is to package
`cloudcols-web` with Electron or Tauri in a later phase (`product-planner` Track F, Phase 16).

Nothing here is built now. These are **readiness rules the web app must follow from Phase 3 onward**
so the wrapper is later a packaging task rather than a rewrite. They are cheap now and expensive to
retrofit:

| Rule | Why |
|------|-----|
| No hard dependency on `window.location.origin` being a public URL | A wrapper serves from `file://` or a local origin |
| All API access through one configurable base URL / binding layer | The wrapper points at a different host |
| Filesystem interactions abstracted behind `downloadFile()` | Native save dialogs replace the DOM anchor trick |
| No reliance on third-party cookies | Webview contexts restrict them |
| Auth flow works inside a webview | OAuth popups behave differently |
| Keyboard shortcuts registered through one manager | Native menus bind to the same commands later |
| No assumption that a tab can be closed/reloaded to reset state | A desktop window is long-lived |

When the wrapper phase begins, it adds: native menu bar, OS drag-in/drag-out, native file picker,
OS downloads folder integration, background transfers while minimized, system tray, auto-update,
code signing, and a `cloudcols://` deep-link scheme.

---

## 5. Web-Specific Rules

- **Routing:** real URLs for every screen (`/files/:folderId`, `/images`, `/developer/keys`). Browser back/forward behaves correctly and preserves scroll position.
- **Deep linking:** any screen is directly linkable; unauthenticated access redirects to login and returns after sign-in.
- **First paint:** render the shell with the fallback font stack immediately; never block on webfonts.
- **Uploads bypass Cloudflare entirely** and go directly to the B2 S3 endpoint via a server-issued presigned URL. The Cloudflare request body limit is bound to the *account plan* (~100 MB Free/Pro, 200 MB Business) — far below the 3 GB file limit, so routing bytes through a Worker is impossible, not merely costly. Downloads and previews **do** go through `cdn.cloudcols.com`.
- **The browser never calls `api.cloudcols.com` directly.** It calls same-origin Next.js route handlers (the BFF), which reach the API Worker over a service binding. That origin exists for Flutter and third-party developers.
- **No credentials in the bundle.** Session lives in an httpOnly cookie, unreadable by JavaScript. Any storage credential, service-role key, or admin secret in a web bundle is a critical security defect.
- **Rendering strategy per route:** SSG for marketing and docs, SSR for share pages, CSR behind auth. Default to Server Components; client components only where interactivity requires it.
- **Tab handling:** transfers are bound to the tab that started them; closing it warns about in-flight uploads via `beforeunload`.
- Right-click is overridden only inside the file area, and always also reachable via the row's overflow button.

---

## 6. Definition of Done (per screen)

- [ ] Layout verified at `md`, `lg`, `xl`, `xxl`
- [ ] Light, Dark, System themes verified
- [ ] Loading, empty, error, offline states verified
- [ ] Permission-denied and quota-exceeded paths verified where applicable
- [ ] Full keyboard traversal with visible focus
- [ ] Browser back/forward correct (web)
- [ ] Long filenames and 1.6× text scale do not clip
- [ ] SEO metadata present (public routes) or `noindex` (authenticated routes)
- [ ] No hardcoded prices, quotas, or limits
- [ ] No secrets, storage URLs, or internal identifiers in the payload
- [ ] Behavior matches the Flutter implementation of the same components
- [ ] `tsc --noEmit` and `eslint` clean; `next build` succeeds; tests pass
