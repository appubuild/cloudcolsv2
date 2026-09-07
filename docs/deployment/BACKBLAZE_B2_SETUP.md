# Backblaze B2 — Setup Guide

CloudCols stores every user file in B2 and serves it through Cloudflare. This document is the
authoritative setup checklist. Values collected here go into Worker secrets, never into the repo.

---

## 1. Create the bucket

| Field | Value | Why |
|-------|-------|-----|
| Bucket Unique Name | `cloudcols-prod` (add a suffix if taken) | Globally unique across all of B2. 6–50 chars, lowercase letters, digits, hyphens. Cannot start with `b2-`. |
| Files in Bucket are | **Private** | Non-negotiable — see §2 |
| Default Encryption | **Enable** (SSE-B2) | Free at-rest encryption. Does not interfere with S3 presigned URLs. |
| Object Lock | **Disable** | Object Lock makes objects immutable for a retention period. That would break Trash, Delete, permanent delete, and quota release — core product features. |

Create a separate `cloudcols-staging` bucket later for the staging environment.

## 2. Why the bucket must be Private

| | Public bucket | Private bucket (chosen) |
|---|---|---|
| Access control | Anyone with the URL, forever | API verifies ownership or share permission on every request |
| Share expiry | Impossible | Enforced |
| Share revocation | Meaningless — the URL keeps working | Immediate |
| Password-protected shares | Impossible | Works |
| Tenant isolation | None at the storage layer | Enforced before every URL is issued |

A public bucket would make the entire sharing model in `design/SCREEN_FLOWS.md` §3.6
unimplementable, and would violate the `security-engineer` skill's object-storage rules.

**Access pattern:** the API issues short-lived presigned URLs. TTL is the `signed_url_ttl_seconds`
system setting (currently 900s / 15 min) and is admin-configurable — not hardcoded.

## 3. Application key — never use the master key

`Application Keys` → `Add a New Application Key`:

| Field | Value |
|-------|-------|
| Name of Key | `cloudcols-api` |
| Allow access to Bucket(s) | **`cloudcols-prod` only** |
| Type of Access | Read and Write |
| Allow List All Bucket Names | unchecked |
| File name prefix | leave empty |
| Duration | leave empty (no expiry) |

The master application key can delete every bucket in the account. It must never be used by the
application. Create a separate key per environment.

**The `applicationKey` is displayed exactly once.** Copy it immediately.

## 4. Lifecycle rule — required for cost control

Bucket → `Lifecycle Settings`.

CloudCols supports 3 GB files via multipart upload. When an upload is abandoned — the user closes the
tab, loses connection, or cancels — the already-uploaded parts remain in B2 and **continue to incur
storage charges** until explicitly removed. On a product built around large files this accumulates
quickly and silently.

Configure the bucket to remove unfinished large-file parts after a short period (1 day is ample;
our resumable-upload window is far shorter). The API also cancels multipart uploads on explicit
user cancellation, but the lifecycle rule is the backstop for the cases the client never reports.

## 5. CORS — needed before browser uploads work

Required because the browser uploads **directly to B2**, bypassing our compute entirely
(`product-planner` invariant 1). Without CORS the browser blocks the request.

Deferred until the production domain exists. When configuring, allow only:

- The real site origin (and `http://localhost:3000` for development)
- Methods needed for S3 multipart: `PUT`, `POST`, `GET`, `HEAD`
- The headers the S3 presigned flow requires, plus exposure of `ETag` — the client must read `ETag`
  from each uploaded part to complete a multipart upload

Never use `*` for the allowed origin on a private bucket in production.

## 6. Region

The bucket detail page shows the S3-compatible endpoint, e.g.
`s3.eu-central-003.backblazeb2.com`. Prefer a **eu-central** bucket so storage sits near the
Supabase project (`eu-central-1`), keeping API-to-storage round trips short. Download latency for
end users is handled by the Cloudflare CDN rather than by bucket placement.

## 7. Values to collect

These go into Worker secrets (`wrangler secret put …`) and local `.env`. **Never commit them.**

| Variable | Where to find it |
|----------|------------------|
| `B2_ENDPOINT` | Bucket details → S3 Endpoint |
| `B2_REGION` | The middle segment of the endpoint, e.g. `eu-central-003` |
| `B2_BUCKET` | The bucket name |
| `B2_KEY_ID` | Application key → `keyID` |
| `B2_APPLICATION_KEY` | Application key → `applicationKey` (shown once) |

## 8. Why the S3-compatible API, not the native B2 API

CloudCols uses B2's **S3-compatible** API. The native B2 API requires a separate
`b2_get_upload_part_url` round trip per part, which is a poor fit for a browser client uploading a
multi-gigabyte file. The S3 API supports presigned URLs for each part, so the client can upload
directly with no further calls to our API.

This also keeps `StorageService` portable: the same code path works against S3, Cloudflare R2,
Wasabi, or self-hosted MinIO, which is the provider-abstraction requirement in `product-planner`
invariant 7.

## 9. Verification checklist

- [ ] Bucket is **Private** (re-check after creation — this is the critical setting)
- [ ] Default encryption enabled
- [ ] Object Lock disabled
- [ ] Application key is bucket-scoped, not the master key
- [ ] Lifecycle rule removes unfinished large-file parts
- [ ] Credentials stored in Worker secrets and local `.env`, absent from git
- [ ] `git log -p | grep -i applicationKey` returns nothing
