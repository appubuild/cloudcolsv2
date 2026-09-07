# CloudCols — Interaction Specification

**Status:** Approved 2026-08-28 · Concrete behavior, timings, thresholds, and state machines.

**Scope boundary:** this file specifies *what happens and when* — exact durations, thresholds, and
state transitions. The `product-experience` skill specifies *how to review and verify* interactions.
Where they overlap, this file is authoritative for values; the skill is authoritative for process.

---

## 1. Global Timings and Thresholds

| Behavior | Value |
|----------|-------|
| Search debounce | 300ms |
| Tooltip delay (desktop) | 500ms hover |
| Long press | 500ms |
| Double-tap window | 300ms |
| Toast duration | 4s (8s with an action) |
| Media chrome auto-hide | 3s idle |
| Optimistic-UI rollback window | 5s (undo available) |
| Skeleton appears after | 150ms (avoids flash on fast responses) |
| Spinner appears after | 400ms |
| "Slow connection" hint after | 8s with no progress |
| Transfer speed/ETA stabilization | 3s of samples before displaying |
| Auto-retry backoff | 1s, 2s, 4s, 8s, 16s — then stop and require manual retry |
| Max auto-retries | 5 |
| Session-expiry warning | 2 min before expiry |
| Double-submit lockout | until the request settles |

---

## 2. Async Operation Contract

Every asynchronous action follows this machine. No exceptions.

```
        ┌──────────────────────────────────────────┐
        │                                          │
   idle ──▶ validating ──▶ submitting ──▶ success ─┘ (toast, optional undo)
             │                 │
             │                 ├──▶ failed ──▶ retry ──┐
             │                 │      │                │
             │                 │      └──▶ idle        │
             │                 │        (input kept)   │
             │                 └──▶ cancelled ◀────────┘
             └──▶ invalid (inline message, input kept, focus moved to first error)
```

Rules:
- The trigger control is disabled and shows a spinner while `submitting`. It never disappears or changes width.
- Failure **never** discards user input.
- Failure messages state what happened and the next action.
- Cancellation is available for anything that can exceed 2s.
- Success feedback is proportional: toast for small actions, inline state for large ones. Never a modal for success.

---

## 3. Upload State Machine

```
selected ─▶ validating ─▶ queued ─▶ preparing ─▶ uploading ─▶ finalizing ─▶ completed
                │                                   │  ▲
                │                                   │  │ resume
                │                                   ▼  │
                │                                 paused
                │                                   │
                ├─▶ rejected                        ├─▶ failed ─▶ retrying ─▶ uploading
                │   (size / type / quota)           │      │
                │                                   │      └─▶ failed_final (manual retry)
                └────────────────────────────────── └─▶ cancelled
```

| State | UI |
|-------|-----|
| `validating` | inline, no queue entry yet |
| `rejected` | inline error before any transfer starts, with the specific reason and remedy |
| `queued` | "Waiting", position shown |
| `preparing` | "Preparing" — requesting the signed URL |
| `uploading` | determinate bar, %, speed, ETA |
| `paused` | `warning` bar, Resume prominent |
| `finalizing` | indeterminate — server-side commit; cannot be cancelled |
| `completed` | `success` check, item fades from the queue after 5s |
| `failed` | `error` bar, reason, Retry |
| `cancelled` | removed; partial parts cleaned up server-side |

Additional rules:
- Concurrency: **3** simultaneous uploads; the rest queue.
- Validation order: type → size → quota. Quota is re-checked server-side at signed-URL issue; a client-side pass is not authorization.
- Network loss auto-pauses; reconnect auto-resumes from the last completed part.
- Closing the app mid-upload: resumable state persists and the queue offers Resume on next launch.
- **Fake or simulated progress is forbidden.** If real progress is unavailable, show indeterminate.

---

## 4. Download State Machine

```
requested ─▶ authorizing ─▶ downloading ─▶ completed
                 │              │  ▲
                 │              ▼  │
                 │            paused
                 ├─▶ denied     │
                 └─▶ expired    └─▶ failed ─▶ retrying
```

- `authorizing`: permission check + signed URL issue. A 403 here surfaces as "You do not have access", never as a raw status code.
- An expired signed URL mid-download transparently re-authorizes once; a second failure surfaces to the user.
- Repeated taps on Download do not start duplicate transfers — the existing one is focused instead.
- Technical storage details (bucket, object key, provider) are never shown.

---

## 5. Selection

| Platform | Enter | Add/remove | Range | All | Exit |
|----------|-------|------------|-------|-----|------|
| Desktop | click | Ctrl/Cmd+click | Shift+click | Ctrl/Cmd+A | Escape / click empty area |
| Mobile | long press | tap | — | toolbar "Select all" | Clear button / back |

- Selection mode is unmistakable: checkboxes visible, `stateSelected` fill, toolbar replaced, count shown.
- Selection survives sort and view-mode changes; it is cleared by navigation and by filter changes.
- Bulk actions show a per-item progress list and report partial success honestly: "5 of 7 moved · 2 failed" with the failures listed and individually retryable.

---

## 6. Drag and Drop (Web/Desktop)

- Drag threshold 8px before a drag begins (prevents accidental drags on click).
- Valid drop target: `primaryContainer` fill + 2px `primary` outline.
- Invalid target: no-drop cursor, no highlight, drop rejected silently.
- Dragging multiple items shows a stacked ghost with the count.
- Dropping onto a breadcrumb segment moves to that folder.
- OS drag-in shows `DropZoneOverlay` and suppresses default browser navigation.
- Auto-scroll when dragging near a list edge.
- **Drag is never the only way** to move a file — Move via menu always exists.

---

## 7. Search

```
idle (recent searches, suggested filters)
  │ type
  ▼
debouncing (300ms) ──▶ querying (inline spinner) ──▶ results | empty | error
  │                                                    │
  └── clear ──▶ idle                                   └── refine filters ──▶ querying
```

- The previous result set stays visible while a new query runs — the screen never blanks.
- Filters apply immediately without re-typing the query.
- Empty results offer "Clear filters" when filters are active, since that is the usual cause.
- Query and filters are reflected in the URL on web so results are linkable and back works.

---

## 8. Media Viewer

**Image:** open `deliberate` (400ms) with a hero transition from the thumbnail. Swipe or arrow keys to
navigate, preloading ±1 neighbour. Pinch and double-tap zoom (double-tap toggles fit ↔ 2×). Pan when
zoomed; swipe-to-next is disabled while zoomed. Escape or swipe-down closes. Chrome hides after 3s
idle and returns on tap or pointer move.

**Video:** poster until play. Seeking shows the buffered range. Controls lock (mobile) prevents
accidental input during playback. Playback position is remembered per file for 30 days. Buffering
shows a spinner over the poster, not a blank frame. An expired URL mid-playback re-authorizes and
resumes at the same position.

**Audio:** playback continues across navigation via `AudioMiniPlayer`. Only one audio stream at a
time. Starting a video pauses audio.

**PDF:** page-by-page rendering; jumping to a page renders that page first rather than everything before it.

---

## 9. Destructive Actions

| Action | Confirmation |
|--------|--------------|
| Move to trash | None — toast with **Undo** for 8s |
| Restore from trash | None — toast |
| Empty trash | Dialog + typed item count |
| Permanent delete | Dialog + typed item count |
| Revoke share link | Dialog, states that existing links stop working |
| Revoke API key | Dialog + key name confirmation, states that integrations will break |
| Delete account | Multi-step + re-authentication + typed confirmation + stated retention period |

Undo is implemented as a real server-side restore, not a delayed request. The item genuinely moves to trash immediately, and Undo restores it.

---

## 10. Offline and Recovery

| Condition | Behavior |
|-----------|----------|
| Connection lost | Banner z=110; transfers auto-pause; mutating actions disabled with explanation; reads served from cache |
| Reconnect | Banner replaced by a `success` toast; transfers auto-resume; stale data revalidated |
| Slow connection | After 8s with no progress, show "Slow connection" alongside continuing progress |
| Session expired | Modal: "Your session expired. Sign in to continue." Current screen and unsaved input are restored after sign-in |
| Server 5xx | Error state with Retry; auto-retry with backoff for idempotent reads only |
| Rate limited (429) | Show the retry-after duration and count down; never silently retry into the limit |

Under no circumstance is a failure silent.

---

## 11. Focus and Keyboard

- Visible `focusRing` (2px + 2px offset) on every focusable element. Never removed.
- Logical tab order matching visual order.
- Dialogs and sheets trap focus and return it to the trigger on close.
- The first meaningful field is autofocused in forms; nothing is autofocused in confirmation dialogs (prevents accidental Enter on a destructive action).
- Escape always closes the topmost layer, one layer per press.
- Skip-to-content link on web.

---

## 12. Accessibility Announcements

Screen readers must be told about state changes that are otherwise visual only:

| Event | Announcement |
|-------|--------------|
| Upload progress | Every 25%, not continuously |
| Upload complete/failed | Immediately, assertive |
| Selection change | "3 items selected" |
| Search results | "12 results" after the query settles |
| Toast | Polite, unless it is an error (assertive) |
| Route change | New screen title |
| Offline / reconnect | Assertive |

Progress bars carry `Semantics(value:)`. Icon-only controls always carry a label. Status is never conveyed by color alone anywhere in the product.

---

## 13. Definition of Done (per interaction)

- [ ] Happy path works
- [ ] Every state in the relevant machine above is reachable and rendered
- [ ] Failure preserves user input
- [ ] Cancel and retry work
- [ ] Double-activation is prevented
- [ ] Offline behavior verified
- [ ] Keyboard path verified (web/desktop)
- [ ] Gesture has a visible alternative (mobile)
- [ ] Screen-reader announcement verified where §12 applies
- [ ] Reduced-motion behavior verified
- [ ] No fake progress, no silent failure, no dead control
