# CloudCols Developer API — Reference (v1)

Base URL: `https://api.yourdomain.com/v1`

Authenticate every request with a Bearer token containing your API key. Keys are scoped, hashed at rest, revocable, and map to exactly one user account server-side — you never supply a `user_id`.

## Authentication

```
Authorization: Bearer cc_live_XXXXXXXXXXX
```

## Rate limits

Per-key, sliding window, configurable by plan:

- `requestsPerMinute`
- `requestsPerMonth`

Responses that exceed the limit return `429 RATE_LIMITED`. Limits are plan-configurable (Free / Developer / Business / Enterprise).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/files` | List files; filters: `type`, `folder`, `search`, `favorite`, `sort`, `page`, `limit` |
| GET | `/v1/files/:id` | Get file metadata |
| GET | `/v1/folders` | List folders |
| GET | `/v1/folders/:id` | Get folder + its children |
| GET | `/v1/files/:id/download-url` | Get a short-lived download URL |
| GET | `/v1/files/:id/preview-url` | Get a short-lived preview URL |
| POST | `/v1/files/upload` | Request an upload ticket (presigned URL) |
| POST | `/v1/files/:id/share` | Create a share link |
| DELETE | `/v1/files/:id` | Delete a file (to trash) |
| GET | `/v1/search` | Search files |

### Scopes (least privilege)

`files.read`, `files.write`, `files.delete`, `folders.read`, `folders.write`, `share.create`, `webhook.manage`.

## Error codes

| HTTP | Code | Meaning |
|------|------|---------|
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | No permission / missing scope |
| 404 | `FILE_NOT_FOUND` | Resource not found (never leaks existence) |
| 413 | `QUOTA_EXCEEDED` | Storage quota exceeded |
| 413 | `FILE_TOO_LARGE` | File exceeds plan limit |
| 429 | `RATE_LIMITED` | Rate limit hit |
| 422 | `INVALID_FILE_TYPE` | Unsupported file type |
| 410 | `SHARE_EXPIRED` / `SHARE_REVOKED` | Share link invalid |

## Upload flow

```
POST /v1/files/upload  {filename, sizeBytes}   →  UploadTicket {presignedUrl, objectKey, uploadId}
PUT  <presignedUrl>  (bytes directly to B2)     →  200
POST /v1/files/upload/:uploadId/confirm        →  verifies object (HEAD), derives category, updates quota
```

Large files should use the chunked/multipart presigned upload with pause/resume/retry.

## Webhooks

Signed POST events: `file.created`, `file.updated`, `file.deleted`, `file.moved`, `file.shared`, `folder.created`, `folder.deleted`. Delivered asynchronously with retries. Verify with the per-endpoint secret (HMAC-SHA256).

## Versioning

The `/v1` namespace is stable. New versions (`/v2`) are additive and never break existing keys or plans.
