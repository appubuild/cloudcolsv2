# CloudCols — Screen Map & User Flows

**Status:** Approved 2026-08-28 (Architecture v2) · Canonical screen inventory, route table, and end-to-end flows.

Routes are shared **conceptually** across clients: web uses them as real URLs, the Flutter app uses
the same paths for deep links and internal routing. The **Platforms** column states where each screen
actually exists — `web` means `cloudcols-web`, `app` means `cloudcols-app`.

Every screen listed here must exist as a real route with real data before the product ships. A screen
that renders but does not perform its function is not done — see the Definition of Done in
[../.claude/skills/product-planner/SKILL.md](../.claude/skills/product-planner/SKILL.md).

---

## 1. Route Table

Web uses real URLs; the Flutter app uses the same paths for deep links and internal routing.

### Public / auth
| Route | Screen | Platforms |
|-------|--------|-----------|
| `/splash` | Splash | app |
| `/onboarding` | Onboarding (3 slides, skippable) | app |
| `/login` | Login | web, app |
| `/register` | Register | web, app |
| `/verify-email` | Email verification | web, app |
| `/forgot-password` | Forgot password | web, app |
| `/reset-password` | Reset password | web, app |
| `/s/:shareToken` | Public share page (**SSR + OG tags**) | **web only** |

### Main application
| Route | Screen | Platforms |
|-------|--------|-----------|
| `/` | Dashboard / Home | all |
| `/files` | My Files (root) | all |
| `/files/:folderId` | Folder | all |
| `/recent` | Recent | all |
| `/favorites` | Favorites | all |
| `/shared` | Shared | all |
| `/trash` | Trash | all |
| `/search` | Search | all |
| `/images` | Images gallery | all |
| `/images/:fileId` | Image viewer | all |
| `/videos` | Video library | all |
| `/videos/:fileId` | Video player | all |
| `/audio` | Audio library | all |
| `/documents` | Documents | all |
| `/pdf` | PDF library | all |
| `/pdf/:fileId` | PDF viewer | all |
| `/files/:fileId/details` | File details | all |
| `/transfers` | Upload + download queue | all |
| `/storage` | Storage dashboard | all |
| `/pricing` | Plans & upgrade | all |
| `/notifications` | Notification center | all |

### Account
| Route | Screen |
|-------|--------|
| `/profile` | Profile |
| `/settings` | Settings root |
| `/settings/account` · `/security` · `/notifications` · `/appearance` · `/storage` · `/sharing` · `/privacy` | Settings sections |

### Developer portal — **web only** (`product-planner` invariant 10)
| Route | Screen |
|-------|--------|
| `/developer` | API overview |
| `/developer/keys` | API keys |
| `/developer/usage` | API usage |
| `/developer/webhooks` | Webhooks |
| `/developer/webhooks/:id` | Webhook detail + deliveries |
| `/developer/docs` | API documentation |
| `/developer/docs/:section` | Documentation section |
| `/developer/plans` | API plans |

### Admin — **web only** (server-side role gate — the route being hidden is not the access control)
`/admin` and sub-routes for Dashboard, Users, Storage, Files, Plans, Subscriptions, Payments, Ads,
Developer API, API Plans, API Usage, API Keys, Webhooks, Sharing, System Settings, Security,
Notifications, Email Templates, Activity Logs, Reports, Maintenance, Feature Flags.

**Total: 48 user-facing screens + 22 admin sections.**

| Surface group | Web | Flutter app |
|---|---|---|
| Shared product screens | yes | yes |
| Public website + share page | yes | — |
| Developer portal (8 screens) | yes | — (links out to web) |
| Admin (22 sections) | yes | — |
| Splash, onboarding | — | yes |

---

## 2. Navigation Model

```
Unauthenticated                 Authenticated
──────────────                  ─────────────
splash                          AppShell
  ├─ onboarding                   ├─ [Home]     /
  ├─ login ──────────────────────▶├─ [Files]    /files → /files/:id (nested, breadcrumbed)
  ├─ register ─▶ verify-email ───▶├─ [Media]    /images · /videos · /audio
  ├─ forgot ─▶ reset ────────────▶├─ [Shared]   /shared
  └─ /s/:token (no auth needed)   └─ [Profile]  /profile → settings · developer · storage

Overlays (any tab): search · transfers · notifications · share ·
                    file details · media viewers · dialogs · sheets
```

Deep links resolve to the correct tab and rebuild the back stack. An unauthenticated deep link
redirects to login and returns to the target after sign-in.

---

## 3. User Flows

### 3.1 Registration
```
Register → validate (email format, password strength, username uniqueness — debounced, live)
  → submit → account created → verification email sent
  → verify-email screen (resend with 60s cooldown)
  → user clicks link → verified → onboarding → Home
```
Failure paths: email taken (inline, suggest login) · username taken (inline, suggest alternatives) ·
weak password (inline strength meter) · rate limited (countdown) · verification expired (resend).

### 3.2 Login
```
Login → submit → session established → restore intended route or Home
```
Failure paths: wrong credentials (generic message, never revealing whether the email exists) ·
unverified (offer resend) · rate limited (countdown) · account suspended (explain, offer support).

### 3.3 Upload a file
```
Upload → source sheet/dropdown → pick → validate (type, size, quota)
  → review (destination, total size, quota impact) → confirm
  → server issues signed upload URL (authorization + quota re-checked server-side)
  → client uploads DIRECTLY to object storage (multipart if large)
  → client notifies server → server verifies, writes metadata, updates usage atomically
  → thumbnail queued asynchronously → file appears in the list
```
The application server never proxies file bytes. Failure at any step surfaces in the queue with a
specific reason and a working Retry that resumes from the last completed part.

### 3.4 Upload multiple files
Same as 3.3, 3 concurrent, rest queued. Per-item states. Partial success reported honestly. The user
continues browsing throughout.

### 3.5 Preview / download
```
Tap file → type detected → preview component
  → server authorizes (ownership OR share permission, file state, expiry)
  → short-lived signed URL issued → media streams via CDN with range requests
```
Download follows the same authorization, then transfers directly from CDN/storage to the client.
Unsupported types skip preview and offer Download / Open externally.

### 3.6 Share a file
```
Select → Share → server creates share record with an unguessable random token
  → configure permission, expiration, optional password → save
  → link generated → copy or native share
  → recipient opens /s/:token → server validates token, expiry, password, revocation
  → preview + download, scoped to that one resource
```
Revoke invalidates immediately and invalidates any cached authorization. A share link never grants
access to anything beyond its target.

### 3.7 Move / rename / delete / restore
- **Move:** select → Move → folder picker (or drag) → optimistic UI → server validates ownership of both source and destination → rollback + toast on failure.
- **Rename:** inline or dialog, pre-filled, extension preserved, validated, saving state, input restored on failure. Only the display name changes — the storage object key never changes.
- **Delete:** → trash immediately, toast with Undo (8s). Trash retention is configurable and trashed files still count toward quota unless configured otherwise.
- **Restore:** from trash → original location, or nearest existing ancestor if that folder is gone.
- **Permanent delete:** dialog + typed count → storage object and metadata removed → usage decremented atomically → audit logged.

### 3.8 Upgrade plan
```
Storage/Pricing → plans fetched FROM SERVER → select → checkout (provider-agnostic)
  → provider confirms server-side (webhook, never client-reported success)
  → subscription + quota updated → ads disabled → confirmation
```
Client-reported payment success is never trusted. Pending states are shown honestly while the webhook settles.

### 3.9 Create an API key
```
Developer → API Keys → Create → name + scopes → submit
  → server generates a cryptographically random key, stores only a hash
  → plaintext returned ONCE in the response
  → UI displays it once with a copy button and an explicit warning
  → leaving the screen destroys it client-side; it can never be shown again
```
Revoke and rotate are immediate and audit-logged. The list only ever shows a masked prefix.

### 3.10 Create a webhook
```
Developer → Webhooks → Create → URL + events + generated secret → save
  → Test delivery → signed request sent → response code and body shown
  → deliveries retried with backoff, all attempts logged
```
Webhook delivery is asynchronous and never blocks a file operation.

### 3.11 Change settings / delete account
- Settings changes save explicitly except toggles, which save immediately with an Undo.
- Account deletion: explain consequences → re-authenticate → typed confirmation → scheduled deletion with a stated grace period → confirmation email → state visible in the app until it completes.

### 3.12 Inactivity lifecycle (server-driven)
```
Active → inactive (configurable) → warning email + in-app banner
  → final warning → grace period → soft delete → permanent deletion
```
Every stage is determined and enforced server-side, is idempotent, and is audit-logged. Never driven by a client-supplied timestamp.

---

## 4. Screen Specification Requirements

Every screen must document, in its feature folder:

1. Purpose · 2. Route + parameters · 3. Layout at `xs`/`md`/`lg` · 4. Components used (from
[COMPONENTS.md](COMPONENTS.md)) · 5. Data dependencies · 6. Loading state · 7. Empty state ·
8. Error states · 9. Offline behavior · 10. Permissions required · 11. Interactions
(per [INTERACTIONS.md](INTERACTIONS.md)) · 12. Keyboard shortcuts · 13. Android/iOS differences ·
14. Light/Dark verification · 15. Accessibility notes.

---

## 5. Build Order

Screens map to the phase plan in
[../.claude/skills/product-planner/SKILL.md](../.claude/skills/product-planner/SKILL.md) §9.
Web and Flutter are separate tracks; Track D can start once Phase 2 (storage core) ships.

### Track C — `cloudcols-web`

| Phase | Screens |
|-------|---------|
| 3 | Login, Register, Verify email, Forgot/Reset password, AppShell |
| 4 | Dashboard, My Files, Folder, Create folder, Transfers, File details, Rename/Move/Copy, Trash, Favorites, Recent, Search |
| 5 | Images, Image viewer, Videos, Video player, Audio, PDF viewer, Documents |
| 6 | Share, **Public share page `/s/:token`**, Shared, Home (marketing), Pricing, Legal |
| 7 | Upgrade / checkout |
| 8 | Developer overview, API keys, Create key, API usage, Webhooks, Create webhook, API documentation |
| 9 | Admin — all 22 sections |
| — | Profile, Settings (all sections), Notifications — built alongside phases 4–7 |

### Track D — `cloudcols-app`

| Phase | Screens |
|-------|---------|
| 10 | Splash, Onboarding, Login, Register, Verify email, Forgot/Reset password, AppShell + bottom nav |
| 11 | Home, Files, Folder, Upload flow, Transfers, Create folder, File details, File action sheet, Trash, Favorites, Recent, Search |
| 12 | Images, Image viewer, Videos, Video player, Audio + mini-player, PDF viewer, Documents, Share, Shared, Storage, Pricing, Profile, Settings, Notifications |

**Not built in Track D:** the Developer portal (8 screens) and Admin (22 sections). Profile links out
to `cloudcols.com/developer` in the system browser.

### Track F — deferred

| Phase | Scope |
|-------|-------|
| 16 | Desktop wrapper around `cloudcols-web` — no new screens, packaging only |
