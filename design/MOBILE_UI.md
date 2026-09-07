# CloudCols — Mobile UI (Android & iOS)

**Status:** Approved 2026-08-28 (Architecture v2) · Layout and screen specification for
**`cloudcols-app`** — the Flutter Android and iOS apps.

> **Scope (Architecture v2):** Flutter Desktop is **ON HOLD**. This document covers phone and tablet
> only. The mobile *web* experience (a browser on a phone) is a separate, also-required surface owned
> by [WEB_DESKTOP_UI.md](WEB_DESKTOP_UI.md).
>
> **Not in this app:** the Developer/API dashboard and the Admin panel are **web-only**
> (`product-planner` invariant 10). Profile links out to the web portal instead.

Android and iOS share one design system, one widget tree, and all business logic. They differ only in
platform interaction conventions (§9). They are not two products.

Values referenced here are defined in [COLORS.md](COLORS.md), [TYPOGRAPHY.md](TYPOGRAPHY.md),
[SPACING.md](SPACING.md); components in [COMPONENTS.md](COMPONENTS.md).

---

## 1. Mobile Principles

Mobile is not a shrunken desktop. Concretely, that means:

- Primary actions sit in the **bottom half** of the screen, within thumb reach.
- Every touch target is **≥ 48×48**, even when the glyph is 24px.
- Contextual actions use **bottom sheets**, never desktop-style context menus.
- Metadata is progressively disclosed — the list shows name + one line, details live in a sheet.
- Thumbnails only; full-resolution media is fetched on demand and never for a list.
- Every destructive or irreversible action is confirmed.
- Every gesture has a visible button alternative.

---

## 2. Navigation

`AppBottomNav`, 5 tabs, 64px + safe area:

| Tab | Root screen | Contains |
|-----|-------------|----------|
| **Home** | Dashboard | greeting, storage, quick actions, recent, category shortcuts |
| **Files** | My Files | All files, folders, Documents, PDF, Other |
| **Media** | Media hub | Images, Videos, Audio |
| **Shared** | Shared | shared by me, shared links, status |
| **Profile** | Profile | Account, Storage, Developer API, Settings, Help |

- Each tab keeps its own navigation stack and scroll position.
- Re-tapping the active tab pops to root; tapping again scrolls to top.
- Trash, Favorites, Recent, Notifications, and Search are reachable from Home and Files, not tabs.
- **FAB** (56px, `primary`) sits above the bottom nav on Home, Files, and Media for Upload. It hides on scroll-down and returns on scroll-up. It is never the only way to upload — Files' top bar carries an upload action too.

---

## 3. Screen Specifications

### Home
- `AppMobileBar`: greeting (`h2`, time-aware), notifications bell with badge, avatar.
- `StorageUsageCard`: ring + "12.4 GB of 20 GB", remaining, Manage / Upgrade.
- Quick actions row: Upload, New folder, Scan, Share (horizontal scroll, 4 visible).
- Recent files: 6 items, horizontal `FileCard` carousel, "See all".
- Media shortcuts: Images, Videos, PDF, Documents tiles with counts.
- Recent activity list.
- States: skeleton, new-account onboarding card, offline banner + cached data.

### Files
- `AppMobileBar`: title, search, overflow (Select, Sort, Filter, View, New folder).
- `Breadcrumbs` horizontally scrollable when inside a folder.
- List (default) or grid, toggled from overflow and remembered per user.
- **Tap** opens/previews. **Long press** enters selection mode.
- Selection mode: top bar becomes count + Clear; bottom action bar (above nav) with Share, Download, Move, Delete, More.
- Pull-to-refresh.
- States: skeleton list, empty folder, no results, offline, permission denied.

### File action sheet
Opened by the row's three-dot button. Canonical order:

Open · Preview · Download · Share · Rename · Move · Copy · Favorite · Details · —— · Delete

Delete is separated and `error`-colored. The sheet header shows the thumbnail, filename, and size.

### Search
- Full-screen. Input autofocused, recent searches, suggested categories.
- 300ms debounce. Results grouped by type.
- Filter chips: Images, Videos, Documents, PDF, Audio. Sort sheet: Name, Date, Size.
- States: idle, loading, results, no results, error.

### Upload flow
1. Tap FAB → `UploadSourceSheet`: Files, Photos, Videos, Documents, Camera (where available).
2. Native picker (single or multi-select).
3. Client-side validation: size, type, quota — failures shown **before** any transfer starts.
4. Review sheet: selected items, destination folder, total size, quota impact, Cancel, Upload.
5. Transfers start; the sheet dismisses; a progress badge appears on the bottom nav.
6. `TransferQueuePanel` (sheet) is reachable from the badge or Home.

Per item: thumbnail, name, size, progress, speed, ETA, Pause, Resume, Cancel, Retry.
Uploads continue while browsing, and continue in the background where the platform allows.
**Never show fake progress.**

### Create folder
Bottom sheet: name field (autofocused, keyboard-aware), Cancel, Create. Validates empty, duplicate, and invalid characters inline. Create shows a button spinner and disables double-submit.

### Media → Images (gallery)
- Adaptive grid: 3 columns at `xs`, 4 at `sm`, 2 when text scale > 1.3.
- Grouped by date with sticky headers. Lazy thumbnails, no full-resolution loads.
- Long press → selection mode.
- Tap → `ImageViewer`: swipe left/right between images, pinch and double-tap zoom, chrome auto-hides after 3s. Actions: Back, Favorite, Share, Download, Delete, More (Details, Rotate).

### Media → Videos
- Grid of `FileCard` with thumbnail, duration pill, filename.
- Tap → fullscreen `VideoPlayer`: play/pause, seek with buffered range, volume, fullscreen, playback speed, control lock, PiP where supported.
- Streams via range requests. Rotating to landscape goes immersive.
- Player gestures (seek scrub, brightness/volume slides) must not conflict with system back/home gestures — keep a 24px inset from screen edges.

### Media → Audio
- List; tap plays into `AudioMiniPlayer` (z=55, above bottom nav) without leaving the screen.
- Tap mini-player → `AudioPlayerExpanded`: artwork, name, scrubber, transport, speed.

### Documents / PDF
- List. PDF opens `PdfViewer`: page navigation, page indicator, zoom, search, download, share.
- Unsupported types open `UnsupportedPreview` with Download / Open externally.

### File details
Bottom sheet (drag to expand to full screen): name, type, size, location, created, modified, owner, sharing status, favorite. Media adds dimensions and duration. Actions row: Rename, Move, Share, Download, Delete.

### Sharing
`ShareView` sheet: current state, permission (View / View + Download), expiration, optional password, generated link, Copy, native share sheet, Revoke. States: Private, Shared, Link accessible, Expired, Revoked.

### Recent · Favorites · Trash
- **Recent:** grouped Today / Yesterday / Earlier; shows last accessed.
- **Favorites:** tabs Files / Folders; long press for selection.
- **Trash:** deleted file, original location, deleted date; Restore, Delete permanently; Empty trash with typed-count confirmation; banner stating retention and that trash still counts toward quota.

### Storage
Large ring, used / remaining / total, category donut with legend, largest files, Upgrade CTA.

### Pricing
Vertically stacked `PlanCard`s (Free, 100 GB, 200 GB, 1 TB) — **all values from the server**. Billing interval toggle. Current plan marked. Restrictions stated plainly.

### Developer / API — **not built in this app**
Developer and API management is **web-only** (`product-planner` invariant 10). The Flutter app must
not contain an API dashboard, key management, webhook management, or the documentation reader.

Profile shows a single row — **"Developer API · manage on the web"** — which opens
`cloudcols.com/developer` in the system browser. If the account has no developer access, the row is
hidden entirely rather than shown disabled.

### Profile & Settings
- Profile: avatar, username, display name, email, plan, storage bar. Menu: Account, Security, Notifications, Appearance, Storage, Developer/API, Privacy, Help, Logout.
- Grouped settings per the master plan (Account, Security, Appearance, Notifications, Storage, Privacy).
- Account deletion: multi-step, states consequences and retention, requires typed confirmation and re-authentication.

### Notifications
List with type glyphs: upload complete/failed, file shared, storage warning, subscription, security alert, API warning. Swipe to mark read. Mark all as read. Tapping deep-links to the relevant screen.

### Auth screens
Splash · Onboarding (3 slides, skippable) · Login · Register · Email verification · Forgot password · Reset password. Keyboard-aware, inline validation, no input lost on failure, rate-limit messaging surfaced clearly.

---

## 4. Loading, Empty, Error, Offline

- **Loading:** skeletons matching real layout; 1200ms shimmer; static under reduced motion; spinners only for sub-second actions.
- **Empty:** every list from [COMPONENTS.md](COMPONENTS.md) §11.
- **Error:** every condition from [COMPONENTS.md](COMPONENTS.md) §12.
- **Offline:** persistent banner at z=110, cached metadata served, mutating actions disabled with an explanation, transfers auto-pause and auto-resume on reconnect, and the user's typed input is never discarded.

---

## 5. Bottom Sheets

Used for file actions, share, sort, filter, create folder, upload source, details, and API actions.
`radiusXl` top corners, drag handle, max 90% height, scrollable body, safe-area bottom padding,
`viewInsets` padding when a field inside is focused. Destructive actions separated at the bottom.
Dismiss by drag-down, scrim tap, or back — all three always work.

---

## 6. Gestures

| Gesture | Where | Visible alternative |
|---------|-------|--------------------|
| Long press | file/folder → selection mode | overflow menu → Select |
| Swipe L/R | image viewer | arrow buttons |
| Pinch / double tap | image, PDF | zoom controls |
| Pull to refresh | all lists | overflow → Refresh |
| Swipe on notification | mark read | tap → mark read |
| Edge swipe back | iOS | back button in the bar |

No swipe-to-delete on file rows — the risk of accidental data loss outweighs the convenience.

---

## 7. Motion

Page transitions `slow` (300ms): shared-axis on Android, Cupertino slide on iOS. Sheets `slow`.
Hover/press `fast` (120ms). Selection `instant`. Image viewer open `deliberate` (400ms).
Progress updates linearly and is exempt from reduced-motion suppression.

---

## 8. Dark Mode

Every screen ships Light and Dark. Dark is not an inversion — see [COLORS.md](COLORS.md) §2.
Specific attention required for: thumbnails (add a subtle `border` so light images do not bleed into the surface), the media player chrome, bottom sheets, the bottom nav, and chart legends.

---

## 9. Android vs iOS

| Area | Android | iOS |
|------|---------|-----|
| Back | System back + predictive back; back from a tab root exits with a confirm-on-double-back | Swipe-from-left-edge, mandatory on every pushed route |
| Transitions | Shared-axis | Cupertino slide |
| Share | Android share sheet | iOS share sheet |
| Permissions | Runtime permissions with rationale before the prompt; handle "Don't ask again" with a settings deep-link | Purpose strings in Info.plist; handle limited photo access |
| Notifications | Channels per category; POST_NOTIFICATIONS on 13+ | Explicit authorization request, deferred to first relevant moment |
| Background transfers | WorkManager-backed | URLSession background tasks; expect stricter suspension |
| Files | Storage Access Framework | Files app / document picker |
| Haptics | Selection + confirmation only | Selection + confirmation only |
| Scroll physics | Clamping | Bouncing |
| Text | Roboto fallback | SF Pro fallback (Inter is bundled and primary on both) |
| Desktop | **ON HOLD** — not a Flutter target | **ON HOLD** — not a Flutter target |

Shared business logic must contain **no** platform conditionals. All platform divergence lives behind
abstractions: `FilePickerService`, `NotificationService`, `BackgroundTransferService`,
`PermissionService`, `ShareService`, `SecureStorageService`. This is what keeps iOS a configuration
task rather than a rewrite.

---

## 10. Mobile Data Efficiency

- Thumbnails only in lists; full media on explicit open.
- Paginate at 40 items; virtualize every list and grid.
- Cache metadata locally with a TTL; cache thumbnails on disk with a size cap and LRU eviction.
- Range requests for video; never pre-download a full file to play it.
- Optional "upload only on Wi-Fi" setting, off by default, surfaced during the first cellular upload.
- Never auto-download originals for preview.

---

## 11. Definition of Done (per screen)

- [ ] Verified on Android and iOS (or documented as iOS-blocked pending a Mac)
- [ ] Behavior matches the web implementation of the same components
- [ ] No developer/API or admin surfaces present
- [ ] Light and Dark verified
- [ ] Loading, empty, error, offline states verified
- [ ] Safe areas correct, including landscape and notched devices
- [ ] Keyboard does not obscure the focused field or primary action
- [ ] Touch targets ≥ 48×48
- [ ] Text scale 1.0 and 1.6 verified without clipping
- [ ] Long filenames truncate correctly and remain fully readable somewhere
- [ ] Android back and iOS swipe-back behave correctly
- [ ] Every gesture has a visible alternative
- [ ] `Semantics` labels present; TalkBack/VoiceOver spot-checked
- [ ] No secrets or storage URLs in the client
- [ ] Widget tests pass; `flutter analyze` clean
