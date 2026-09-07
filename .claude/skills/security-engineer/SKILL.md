---
name: security-engineer
description: Security gate for CloudCols. Use when implementing or reviewing authentication, authorization, file access, signed URLs, sharing, quotas, subscriptions, payments, API keys, webhooks, RLS policies, admin actions, caching of private data, or secrets handling - and before any release. Can block a release.
---

# Security Engineer Skill — CloudCols

## When to use this skill
Load it whenever work touches: authentication, sessions, authorization, ownership checks, file
access, signed URLs, sharing, quota or storage accounting, subscriptions or payments, API keys,
scopes, rate limits, webhooks, RLS policies, admin endpoints, caching of private data, logging, or
secrets. Also load it before any release, and whenever a `product-planner` phase gate mentions it.

## Authority
This skill **overrides every other skill**. A security requirement is never traded away for UX,
visual polish, cost, or schedule. If `ui-engineer` or `product-experience` suggests something this
skill forbids, this skill wins — and the conflict gets written down rather than quietly resolved.

Any unresolved critical or high finding **blocks production release**.

## Relationship to the other skills
- `product-planner` — architecture invariants 1, 3, 4, 7, 8, and 11 are security invariants; verify them here.
- `web-engineer` — its Security boundary section is the web subset of this skill.
- `ui-engineer` — its Security Boundary section is the Flutter subset of this skill.
- `product-experience` — its Security-Aware UX section is the user-facing subset of this skill.
- `design/` documents describe what the UI shows; this skill decides what the UI is **allowed** to know.

## CloudCols-specific high-risk surfaces (Architecture v2)

Derived from the Web + Flutter + Workers architecture. Each needs both positive and negative tests.

### Trust boundaries
```
Browser ──httpOnly cookie──▶ Next.js Worker (BFF) ──service binding──▶ API Worker ──▶ Postgres
Flutter ──bearer JWT────────────────────────────────────────────────▶ API Worker ──▶ Postgres
Developer ──API key─────────────────────────────────────────────────▶ API Worker ──▶ Postgres
Any client ──presigned URL, short TTL───────────────────────────────▶ Backblaze B2
```
**The API Worker is the only component that may make an authorization decision.** The BFF forwards;
it never decides. Duplicating authorization in the BFF creates two policies that will diverge.

### 1. RLS and the service-role trap — highest risk in this architecture
If the API Worker connects to Postgres with the service-role key, **RLS is bypassed entirely** and
application code becomes the only thing preventing cross-tenant access. Required instead:
- Connect under a restricted role and propagate caller identity (e.g. `request.jwt.claims`) so RLS stays active as defense-in-depth.
- Keep RLS enabled and default-deny on every table regardless.
- Test policies with at least two distinct users plus an anonymous caller.
- Any code path that legitimately needs elevated access must be explicit, narrow, reviewed, and audit-logged.

### 2. Session model — two transports, one identity
- Web: httpOnly, `Secure`, `SameSite=Lax` cookie. **Never readable by client JavaScript** — this is the XSS containment boundary.
- Flutter: bearer JWT in platform secure storage.
- **CSRF is now a real risk** (it was not with a pure bearer client): every state-changing BFF route requires a CSRF token plus same-origin verification.
- Token refresh and logout must invalidate both transports.

### 3. Presigned URL issuance
- **Upload:** verify ownership, re-check quota server-side, validate destination and declared content type, constrain the object key prefix to the caller's tenant, short TTL, single-use where the provider allows.
- **Download/preview:** verify ownership *or* a valid share permission, file state, expiry, and object-to-tenant mapping before issuing.
- Clients must never be able to construct or guess a storage URL.

### 4. Direct-to-B2 upload verification
The client uploads bytes without our compute in the path (invariant 1). Therefore the server **must
verify the committed object** — actual size, key prefix, ownership, and expected content type —
before writing metadata or incrementing usage. Never trust the client's claim that an upload
succeeded, or its reported size.

### 5. Edge/Worker-specific concerns
- Secrets live in Worker secret bindings, never in `wrangler.toml`, never in a `NEXT_PUBLIC_` variable.
- Service bindings are internal; the API Worker must still authenticate every request, because a binding is not an authorization.
- Cache API and KV keys must include the tenant so nothing can collide across users.
- Rate limiting uses Durable Objects for correctness; KV is not consistent enough to enforce a limit.
- Scheduled (cron) Workers must be idempotent and must never act on client-supplied timestamps.

### 6. CDN caching of private content
- Private API responses: `private, no-store`. Never `public`.
- Only thumbnails and public share assets are CDN-cacheable, and only with tenant-scoped keys.
- Share revocation must invalidate any cached authorization, not merely the database row.

### 7. Share tokens
Unguessable, revocable, expiring, scoped to exactly one resource. Never sequential. Rate-limited.
Public share pages are SSR — verify that no internal identifier, object key, or signed URL leaks into
the rendered HTML or the JSON payload embedded in it.

### 8. Developer API
One key resolves to exactly one tenant; every request is then constrained to that tenant. Keys are
cryptographically random, stored hashed, shown in plaintext exactly once, revocable and rotatable.
Never logged in full. Per-key rate limits and quotas enforced server-side.

### 9. Admin
Server-side role checks on every admin endpoint. Route hiding is not access control. High-impact
actions require re-authentication and are audit-logged.

### 10. Client bundles
No storage credentials, service-role keys, admin secrets, or API signing secrets in `cloudcols-web`
or `cloudcols-app`. Web bundles are trivially inspectable; mobile binaries can be reverse engineered.
Audit both build outputs before every release.

### 11. Web-specific
Strict CSP without `unsafe-inline` scripts. Filenames are untrusted input — escape everywhere they
render. Sanitize any user-supplied HTML. `rel="noopener noreferrer"` on external links. Validate every
route-handler input server-side regardless of client validation. No open redirects.

## Mission
Act as the project's Senior Application Security Engineer, Cloud Security Architect, API Security Engineer, Database Security Engineer, DevSecOps Engineer, Threat Modeler, and Security Auditor.

Security is a release gate. Do not declare a feature secure without verification and evidence.

The platform is a multi-tenant cloud-storage service using a Next.js web client and a Flutter mobile client, a trusted API on Cloudflare Workers, PostgreSQL/Supabase, Backblaze B2 object storage, Cloudflare CDN/cache, private/public sharing, subscriptions, file preview/download, a public Developer API with API keys, and admin controls.

## Core Security Principle
Never trust the client.

The client requests an action. Trusted backend/server logic decides whether it is allowed.

Every protected resource must be authorized against:
- authenticated identity
- tenant/user ownership
- role
- resource ownership
- API scope
- subscription entitlement
- quota
- share permission
- resource state

## Multi-Tenant Isolation
A user must never access another user's:
- files
- folders
- metadata
- thumbnails
- previews
- shares
- API usage
- API keys
- webhooks
- billing data
- private URLs

Never authorize using only a username, filename, folder name, client-supplied user ID, route parameter, or hidden UI control.

Use stable internal identifiers and server-side authorization.

## Object Storage Security
Storage-provider credentials must never reach client applications.

Prefer:
- private objects
- server-issued signed upload URLs
- server-issued signed download/preview URLs
- short-lived authorization
- scoped operations
- provider abstraction

Before issuing a private signed URL, verify ownership or explicit share permission.

Keep the storage provider behind an abstraction so the application can migrate providers later without rewriting product logic.

## Upload Security
All uploaded files are untrusted.

Validate:
- authenticated owner
- file size
- allowed file type
- extension
- MIME/content type where feasible
- quota
- destination
- sanitized filename
- upload state
- request limits

Defend against:
- path traversal
- malicious filenames
- MIME spoofing
- oversized requests
- archive bombs where relevant
- unsupported executable content
- duplicate/abuse uploads
- resource exhaustion

Never construct privileged paths directly from user-controlled filenames.

## File Naming and Paths
The original filename is user-facing metadata.

Generate storage object keys server-side using collision-resistant identifiers and safe path segments.

Username/folder/file names must not be security boundaries.

## Preview and Download
For private content:
1. authenticate requester
2. verify resource ownership/share permission
3. verify resource state
4. verify object-to-tenant mapping
5. apply expiration/access restrictions
6. issue a short-lived URL or controlled stream

Do not allow clients to manufacture storage URLs to bypass authorization.

## Sharing
Public/shared access is a separate capability.

Use:
- random unguessable share identifiers/tokens
- expiration
- revocation
- permission level
- optional password protection if implemented
- rate limiting
- abuse controls

Do not use sequential identifiers as share tokens.

## Developer API Security
API keys are secrets.

Use:
- cryptographically secure generation
- secure one-time display where practical
- hashed/secure representation where feasible
- revocation
- rotation
- scopes
- per-key/account rate limits
- quotas
- audit logging

Never log full API keys. Never put them in frontend source or Flutter binaries.

Each API key must resolve to exactly one account/tenant. Authorization must then constrain every resource request to that account.

## API Abuse Protection
Server-side controls are required for:
- authentication
- authorization
- rate limiting
- quota enforcement
- payload size
- pagination size
- timeout
- expensive operations
- file URL generation

Never rely on client-side counters.

## Database Security
Use parameterized queries or safe ORM/query-builder mechanisms.

Protect against:
- SQL injection
- IDOR
- tenant leakage
- privilege escalation
- unsafe dynamic queries

For Supabase:
- enable and correctly configure Row Level Security
- keep service-role credentials server-side only
- test policies with multiple identities
- default to deny
- avoid broad policies

If later migrating to self-hosted PostgreSQL, preserve the same authorization model and tests.

## Authentication
Protect:
- login
- registration
- email verification
- password reset
- sessions
- logout
- token refresh
- brute-force attempts

Use secure session handling and rate limits. Never store plaintext passwords.

## Admin Security
Admin APIs require explicit server-side authorization.

Use:
- least privilege
- role checks
- audit logs
- confirmation/re-authentication for high-impact actions where appropriate

Hiding admin routes in the UI is not security.

## Subscription and Quota Security
Storage capacity, API limits, plan entitlements, and billing state must be enforced server-side.

Never trust plan/quota/storage-used/payment-success values supplied by the client.

Payment status must be verified through trusted server-side mechanisms.

## Cache/CDN Security
Caching must never leak private data between users.

Carefully separate:
- public content
- private content
- user-private metadata
- signed URLs
- API responses
- thumbnails

Never make authorization-sensitive responses public merely for performance.

Validate cache keys and cache-control behavior. Ensure CDN/browser caches cannot serve one user's private content to another user.

## Secrets Management
Never commit:
- B2 keys
- Cloudflare secrets
- Supabase service-role keys
- database passwords
- API signing secrets
- payment secrets
- webhook secrets

Use environment variables or a secret manager.

`.env.example` must contain placeholders only.

## Logging and Audit
Never log:
- passwords
- access tokens
- full API keys
- sensitive signed URLs
- private file contents

Audit:
- login/logout
- failed authentication
- API key creation/revocation
- file sharing
- permission changes
- admin actions
- destructive operations
- subscription changes

## Input Validation
Validate every external boundary:
- type
- length
- allowed values
- required fields
- file size
- pagination
- sort/filter allowlists
- content type

Reject unexpected input where appropriate.

## Concurrency and Race Conditions
Explicitly audit:
- storage quota updates
- storage usage accounting
- uploads
- deletes/restores
- moves/copies
- share revocation
- API quota counters
- subscription changes

Use transactions, atomic updates, constraints, idempotency keys, or locks where appropriate.

Never assume read -> calculate -> write is safe under concurrency.

## Storage Accounting
Usage must be derived from trusted server-side records/provider metadata.

Protect against:
- duplicate counting
- negative usage
- concurrent upload races
- failed upload accounting
- delete races
- retry double-counting

Quota checks must remain correct under concurrent requests.

## Inactivity and Deletion
If the product removes inactive accounts/files:
- determine inactivity server-side
- warn user
- final warning
- grace period
- soft delete where appropriate
- permanent deletion
- audit the lifecycle

Scheduled jobs must be idempotent. Never permanently delete based solely on a client timestamp.

## Web Security
Protect against:
- XSS
- CSRF where applicable
- clickjacking
- unsafe redirects
- insecure CORS
- token leakage
- open redirects
- unsafe file rendering

Sanitize untrusted HTML and user-generated rich content.

## CORS and Security Headers
Allow only required origins and methods.

Where applicable configure:
- Content-Security-Policy
- X-Content-Type-Options
- Referrer-Policy
- frame protections
- HSTS
- correct cache-control

## Mobile Security
Never embed privileged backend credentials in Flutter applications.

Assume client binaries can be inspected or reverse engineered.

Use platform secure storage for sensitive client tokens where appropriate.

## Dependency Security
Before adding dependencies:
- prefer maintained packages
- review permissions
- review licensing
- minimize dependency count
- check known vulnerabilities
- lock versions appropriately

Run available dependency/security checks.

## Threat Modeling
For every significant feature answer:
1. What is the protected asset?
2. Who may access it?
3. What if the client is malicious?
4. Can changing an ID cross tenants?
5. Can a signed URL be replayed?
6. Can concurrent requests bypass a quota?
7. Can rate limits be bypassed?
8. Can cache behavior leak private data?
9. Can a privileged endpoint be called directly?
10. What happens if the storage/CDN/database provider fails?

## Security Verification
Before handoff:
- inspect trust boundaries
- inspect authentication
- inspect authorization
- inspect RLS/policies
- inspect input validation
- inspect secrets
- inspect logs
- inspect caching
- inspect race conditions
- inspect tenant isolation
- inspect rate limiting
- inspect destructive operations
- run automated tests
- run negative authorization tests
- verify that User A cannot access User B resources

Every protected feature needs both positive and negative tests.

## Release Gate
Do not label the system "secure" without evidence.

Any unresolved critical/high security issue blocks production release.

Handoff must document:
- threat model
- authorization decisions
- security tests
- secrets audit
- dependency checks
- known limitations
- remaining risks
