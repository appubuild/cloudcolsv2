---
name: product-experience
description: Interaction quality and pixel-perfect QA gate for CloudCols. Use when implementing or reviewing any user-facing screen, flow, dialog, sheet, upload/download experience, navigation, preview, sharing flow, notification, or micro-interaction - and always before declaring a screen complete.
---

# Product Experience & Pixel-Perfect Interaction Skill — CloudCols

## When to use this skill
Load it whenever you implement or review a user-facing screen or flow, and **always** as the final
gate before calling a screen complete. It is the always-on product-experience QA layer.

## Scope boundary
This skill owns **process**: how to think about an interaction, how to review it, how to verify it,
and when it is done. It does not own values.

| Concern | Owner |
|---------|-------|
| Exact timings, thresholds, state machines | `design/INTERACTIONS.md` |
| Component specs, required empty/error states | `design/COMPONENTS.md` |
| Screen layouts and platform behavior | `design/WEB_DESKTOP_UI.md`, `design/MOBILE_UI.md` |
| Routes and end-to-end user flows | `design/SCREEN_FLOWS.md` |
| Colors, type, spacing | `design/COLORS.md`, `TYPOGRAPHY.md`, `SPACING.md` |
| How UI is built in Flutter | `ui-engineer` skill |
| What gets built and whether it is in scope | `product-planner` skill |
| Anything touching auth, credentials, or authorization | `security-engineer` skill (**overrides this one**) |

Where this skill and a design document appear to disagree, the design document wins on values and
this skill wins on process.

## Golden Rules
1. Every click, tap, swipe, drag, keyboard action, and system action must have an intentional result.
2. Never leave dead buttons, fake controls, placeholder interactions, or decorative controls that appear actionable.
3. Reuse existing components and patterns before creating new ones.
4. Never invent inconsistent spacing, colors, typography, shadows, radii, or animations.
5. Never sacrifice accessibility for visual appearance.
6. Never sacrifice security for convenience.
7. Never hide important feedback from the user.
8. Never block the entire application for a background operation unless necessary.
9. Preserve user state during navigation and recovery.
10. Every asynchronous operation needs appropriate loading, success, failure, cancellation, and retry behavior.

## Interaction State Matrix
Consider every interactive element in:
- Default
- Hover
- Focus
- Pressed
- Selected
- Disabled
- Loading
- Success
- Error
- Warning
- Offline
- Permission denied
- Quota exceeded
- Expired
- Empty
- Partial completion

Never implement only the happy path.

## Interaction Specifications

The detailed behavior specifications that used to live here are now in the design documents, with
concrete values instead of prose. Read the owner, then review against it:

| Area | Owner |
|------|-------|
| Navigation, breadcrumbs, back behavior, tab stacks | `design/WEB_DESKTOP_UI.md`, `design/MOBILE_UI.md` |
| Buttons, icons, inputs, menus, dialogs, sheets, toasts | `design/COMPONENTS.md` sections 4-5 |
| Upload and download experience, queue, per-item states | `design/INTERACTIONS.md` sections 3-4 |
| File and folder operations, rename, move, delete, restore | `design/SCREEN_FLOWS.md` section 3.7 + `design/INTERACTIONS.md` section 9 |
| Selection, drag and drop | `design/INTERACTIONS.md` sections 5-6 |
| Search, filters, sorting | `design/INTERACTIONS.md` section 7 |
| Preview and gallery | `design/INTERACTIONS.md` section 8 + `design/COMPONENTS.md` section 7 |
| Sharing | `design/SCREEN_FLOWS.md` section 3.6 + `design/COMPONENTS.md` section 10 |
| API dashboard, key creation, webhooks | `design/COMPONENTS.md` section 9 + `design/SCREEN_FLOWS.md` sections 3.9-3.10 |
| Storage and pricing | `design/COMPONENTS.md` section 8 |
| Offline, errors, recovery, session expiry | `design/INTERACTIONS.md` section 10 + `design/COMPONENTS.md` section 12 |
| Loading and empty states | `design/COMPONENTS.md` section 11 |
| Notifications | `design/MOBILE_UI.md`, `design/WEB_DESKTOP_UI.md` |
| Keyboard shortcuts | `design/WEB_DESKTOP_UI.md` section 3 |
| Gestures and their required visible alternatives | `design/MOBILE_UI.md` section 6 |
| Motion, durations, curves, reduced motion | `design/SPACING.md` section 4 |
| Responsive breakpoints | `design/SPACING.md` section 5 |
| Safe areas and keyboard handling | `design/SPACING.md` section 8 |
| Text scaling, truncation, i18n, date/time formatting | `design/TYPOGRAPHY.md` sections 3-6 |
| Large data sets, pagination, virtualization | `ui-engineer` Performance section |
| Account lifecycle states | `design/SCREEN_FLOWS.md` section 3.12 |

See **Final Instruction** at the end of this file for the review lens to apply to every one of them.

## Visual Consistency
Before creating a component ask:
1. Does an existing component solve this?
2. Can it be extended?
3. Does this interaction already exist elsewhere?
4. Does it follow design tokens?
5. Does it work on mobile and desktop?
6. Does it work in Light/Dark/System themes?
7. Does it cover important states?

## Pixel-Perfect QA
A screen is not complete because it compiles.

After implementation:
1. Run the application.
2. Inspect the real rendered screen.
3. Compare with the approved design/reference.
4. Check alignment, spacing, typography, icons, dimensions, radii, shadows, colors.
5. Check responsive behavior.
6. Check Light/Dark themes.
7. Check loading, empty, error, offline, and long-text states.
8. Check accessibility.
9. Check keyboard/touch behavior.
10. Fix discrepancies.
11. Re-run.
12. Only then mark complete.

## Implementation Discipline
### Phase A — Understand
Read the plan, UI skill, security skill, inspect existing implementation, identify reusable components, responsive requirements, and states.

### Phase B — Plan
Write a concise implementation plan before major changes.

### Phase C — Implement
Use existing architecture and design tokens.

### Phase D — Verify
Test happy path, invalid input, loading, failure, retry, cancellation, responsive behavior, accessibility, and security-sensitive paths.

### Phase E — Visual QA
Inspect the actual rendered result.

### Phase F — Handoff
Report changes, tests performed, known limitations, and follow-up requirements.

## Never Do This
Never leave placeholder/dead buttons, use random emoji as production icons, scatter arbitrary design values, use fake progress, hide errors, silently delete data, make critical actions gesture-only, expose secrets, trust client-side permissions/quota, carelessly cache private data, make every action a popup, or declare pixel-perfect/secure/complete without verification.

## Definition of Done
- Functional behavior works.
- Every actionable control works.
- Loading/success/error states work.
- Empty state works where relevant.
- Retry/cancel work where relevant.
- Responsive behavior works.
- Light/Dark themes work.
- Accessibility checked.
- Performance considered.
- Security boundaries preserved.
- No secrets exposed.
- No dead UI.
- Visual QA completed.
- Relevant tests/build pass.
- Known limitations documented.

## Priority Order
1. Security
2. Data integrity
3. Functional correctness
4. Accessibility
5. Performance
6. Usability
7. Visual polish
8. Decorative animation

## Final Instruction
Treat this document as an always-on Product Experience QA layer.

For every UI change, think beyond the screenshot:
What happens before the action? During it? After it? If it fails? If the network disappears? If the user taps twice? On mobile? On desktop? With a large file? With a long filename? When permission expires? When quota is exceeded? When the user returns later?

Design and implement the complete experience—not just the happy path.
