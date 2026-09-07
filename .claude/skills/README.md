# CloudCols Skill System

**Last updated:** 2026-08-28 · **Architecture v2** (Next.js web + Flutter mobile + Workers API)

Five skills plus nine design documents. Each owns a distinct concern. Read this routing table before
starting any task.

---

## 1. Routing — which skill for which task

| If the task is about… | Load |
|-----------------------|------|
| Scope, phases, architecture, infrastructure, cost, deployment, data model, API surface, "is this done?" | **product-planner** |
| Anything in `cloudcols-web` — a page, React component, route handler, SEO surface, admin screen, developer-portal screen | **web-engineer** |
| Anything in `cloudcols-app` — a Flutter widget, screen, theme, or mobile visual QA | **ui-engineer** |
| How an interaction behaves; reviewing a screen before calling it complete (either client) | **product-experience** |
| Auth, authorization, file access, signed URLs, sharing, quota, payments, API keys, RLS, admin, secrets, edge/Worker security | **security-engineer** |
| A color, size, spacing, radius, duration, breakpoint, component name, route, or user flow | **`design/` documents** (not a skill — read directly) |

Most non-trivial tasks load two or three. A new web screen typically loads `product-planner` (scope) →
`web-engineer` (build) → `product-experience` (verify), plus `security-engineer` if it touches
anything in that skill's trigger list.

---

## 2. Dependency graph

```
product-planner ─ product scope, architecture, phases, Definition of Done
      │
      ├──▶ web-engineer  ─ Next.js + TypeScript      (cloudcols-web)
      │         │
      │         └──▶ design/* ─ THE shared visual source of truth (all values)
      │                  ▲
      ├──▶ ui-engineer ──┘  ─ Flutter                (cloudcols-app)
      │
      ├──▶ product-experience ─ interaction behavior + QA process (both clients)
      │
      └──▶ security-engineer  ─ security gate; can block any release
```

**One design system, two implementations.** `design/` is shared. `web-engineer` and `ui-engineer`
each describe how *their* platform realizes it. They must never disagree about behavior — only about
technology.

## 3. Precedence when skills appear to conflict

1. **security-engineer** overrides everything. Never traded for UX, cost, or schedule.
2. **product-planner** defines *what* is built and *whether it is done*.
3. **`design/` documents** define every visual **value** and every component contract.
4. **web-engineer / ui-engineer** define *how* their platform implements it.
5. **product-experience** defines *how* interactions behave and how screens are QA'd.

Rule of thumb: design documents win on **values and contracts**, platform skills win on **technique**,
security wins on **everything**.

---

## 4. Structure

```
.claude/skills/
├── README.md                    ← this file
├── product-planner/SKILL.md     ← master plan + Architecture v2 + phase plan
├── web-engineer/SKILL.md        ← Next.js + TypeScript (cloudcols-web)
├── ui-engineer/SKILL.md         ← Flutter (cloudcols-app, Android + iOS)
├── product-experience/SKILL.md  ← interaction QA gate (both clients)
└── security-engineer/SKILL.md   ← security gate

design/                          ← shared by BOTH clients
├── UI_DESIGN_SYSTEM.md   index + ownership map + token pipeline (holds no values)
├── tokens.json           ← THE machine-readable source (created in Phase 0)
├── COLORS.md             every color value + contrast evidence
├── TYPOGRAPHY.md         families, scale, truncation, i18n text
├── SPACING.md            spacing, radii, elevation, motion, breakpoints, dimensions, z-order
├── COMPONENTS.md         canonical component inventory + naming authority (both clients)
├── WEB_DESKTOP_UI.md     web shell, screens, shortcuts, deferred desktop-wrapper rules
├── MOBILE_UI.md          mobile shell, screens, gestures, Android/iOS
├── INTERACTIONS.md       timings, thresholds, state machines
└── SCREEN_FLOWS.md       routes, navigation model, user flows, build order
```

Every `SKILL.md` has YAML frontmatter (`name`, `description`) so Claude Code can discover and route to
it. A skill file without frontmatter is invisible to the Skill tool.

---

## 5. Naming authority

`design/COMPONENTS.md` §0 is the single authority for component names, **shared by both clients**.
A component name means the same behavior, states, and semantics in React and in Flutter — only the
implementation differs. When any document disagrees with it, it wins.

`design/COMPONENTS.md` also lists which components are **web-only** (developer portal, admin,
`PublicSharePage`) and which are **mobile-only** (`AppBottomNav`, `AudioMiniPlayer`).

---

## 6. Skills deliberately **not** created

### ai-engineer — not applicable

An `ai-engineer` skill was requested. After auditing the full master plan and design documents,
**CloudCols contains no AI or ML functionality**, so the skill would have no subject matter. Creating
it would mean inventing features the product does not have, which the master plan explicitly forbids.

What CloudCols actually needs where an AI feature might be assumed:

| Capability | How CloudCols does it | Why not AI |
|------------|----------------------|------------|
| File categorization | Backend-authoritative MIME + extension mapping | Deterministic, free, instant, testable (Master Plan §11) |
| Search | PostgreSQL full-text and trigram search | Master Plan §42 forbids introducing search infrastructure before scale requires it |
| Thumbnails | Client-side generation at upload | Image decoding, not inference |
| Duplicate detection | File hash + size + MIME, per user | Master Plan §43. Exact hashing beats similarity and avoids cross-tenant privacy problems |
| Storage insights | SQL aggregation | Master Plan §19 |

**Reconsider if** the product later adds semantic search, image tagging, OCR, content-based
deduplication, AI-assisted organization, or an in-app assistant. Any of those would justify a skill
covering model selection, cost per operation, and — most importantly — the privacy implications of
sending user file content to a third-party model, which would materially extend the
`security-engineer` threat model.

### backend-engineer — folded into product-planner and security-engineer

The API layer (`cloudcols-api`, TypeScript on Cloudflare Workers) is governed by `product-planner`
§7 (architecture, responsibilities, deployment) and `security-engineer` (authorization, RLS, secrets,
rate limiting, edge concerns). A separate skill would duplicate both. Revisit if the API grows a
distinct body of implementation convention not covered by those two.

---

## 7. Definition of Done — where to find it

No single global checklist; each layer has its own and they compose:

| Layer | Checklist |
|-------|-----------|
| Phase | `product-planner/SKILL.md` §5 |
| Feature | `product-planner/SKILL.md` Master Plan §71 |
| Web task | `web-engineer/SKILL.md` Definition of Done |
| Flutter task | `ui-engineer/SKILL.md` Visual QA Checklist + Definition of Done |
| Screen / interaction | `product-experience/SKILL.md` Definition of Done |
| Component | `design/COMPONENTS.md` §13 |
| Web screen | `design/WEB_DESKTOP_UI.md` §6 |
| Mobile screen | `design/MOBILE_UI.md` §11 |
| Interaction | `design/INTERACTIONS.md` §13 |
| Security | `security-engineer/SKILL.md` Release Gate |

---

## 8. Maintaining this system

- Adding a component → add it to `design/COMPONENTS.md` **first**, then implement in whichever client needs it. State whether it is shared, web-only, or mobile-only.
- Changing a token value → edit `design/tokens.json`, regenerate both outputs, re-run the contrast check if it is a color, update the evidence table in `COLORS.md` §5.
- Changing an API shape → edit the OpenAPI spec first, regenerate both clients. Never hand-edit a generated client.
- Changing brand color, typography, or density → approved decisions (`UI_DESIGN_SYSTEM.md` §2). Requires re-approval.
- Changing architecture → `product-planner` §7, and add a row to the §10 supersession table so the obsolete guidance is explicitly marked rather than silently contradicted.
- Adding a skill → frontmatter, routing table §1, precedence §3.
- **Never restate a value in a skill file.** Link to the owning design document instead.
