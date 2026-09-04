// CloudCols domain types.
// These interfaces mirror the shape of the future Postgres schema so that the
// UI layer, the mock repositories, and the real API layer all share one contract.

export type Role = "guest" | "user" | "developer" | "admin";

export type UserStatus = "active" | "suspended" | "pending_deletion";

export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "document"
  | "archive"
  | "other";

export type FileStatus =
  | "ready"
  | "pending" // upload started, bytes not yet confirmed
  | "quarantined" // hidden from owner + shares (moderation)
  | "processing"; // thumbnail/gen metadata in progress

export type BillingInterval = "monthly" | "yearly";

export type PermissionLevel = "view" | "download";

export type ShareTokenStatus = "active" | "expired" | "revoked" | "not_found";

export interface User {
  id: string;
  email: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  planId: string;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  role: Role;
  developerEnabled: boolean;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string;
}

export interface Folder {
  id: string;
  ownerId: string;
  parentId: string | null;
  name: string;
  path: string; // breadcrumb trail, e.g. "Work / Projects"
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  isFavorite: boolean;
  /** Pinned folders sort above everything else in their parent. */
  isPinned: boolean;
  /** Icon key chosen by the owner; null is the default folder icon. */
  icon: string | null;
  lastAccessedAt: string | null;
}

export interface File {
  id: string;
  ownerId: string;
  folderId: string | null;
  objectKey: string; // opaque, server-generated — never the original filename
  originalFilename: string;
  mimeType: string;
  category: FileCategory; // backend-authoritative
  sizeBytes: number;
  thumbnailUrl: string | null;
  checksum: string | null;
  status: FileStatus;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  lastAccessedAt: string | null;
}

export type FileListItem = File | Folder;

// Query params accepted by the file listing (used identically by mock + real API).
export interface FileListParams {
  folderId?: string | null;
  category?: FileCategory | null;
  search?: string;
  sort?: "name" | "size" | "modified" | "accessed" | "favorite";
  order?: "asc" | "desc";
  favoritesOnly?: boolean;
  trashed?: boolean;
  recent?: boolean;
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Plan {
  id: string;
  name: string;
  tagline: string;
  storageQuotaBytes: number;
  priceCents: number;
  billingInterval: BillingInterval | null; // null = free
  features: string[];
  showsAds: boolean;
  apiIncluded: boolean;
  maxFileSizeBytes: number;
  isActive: boolean;
  sortOrder: number;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: "active" | "cancelled" | "expired" | "past_due";
  provider: string | null;
  startedAt: string;
  renewsAt: string | null;
  cancelledAt: string | null;
}

export interface Payment {
  id: string;
  userId: string;
  subscriptionId: string | null;
  amountCents: number;
  currency: string;
  provider: string | null;
  status: "succeeded" | "failed" | "refunded" | "pending";
  createdAt: string;
}

export interface ShareLink {
  id: string;
  ownerId: string;
  fileId: string | null;
  folderId: string | null;
  token: string;
  permission: PermissionLevel;
  expiresAt: string | null;
  isRevoked: boolean;
  createdAt: string;
  accessCount: number;
}

export interface ApiPlan {
  id: string;
  name: string;
  requestsPerMonth: number;
  rateLimitPerMinute: number;
  priceCents: number;
  isActive: boolean;
}

export interface ApiKey {
  id: string;
  userId: string;
  apiPlanId: string;
  keyPrefix: string; // visible only
  hashedKey: string; // never displayed after creation
  label: string;
  scopes: string[];
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiRequestLog {
  id: string;
  apiKeyId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTimeMs: number;
  createdAt: string;
}

export interface Webhook {
  id: string;
  userId: string;
  url: string;
  events: string[];
  status: "active" | "disabled";
  secret: string;
  createdAt: string;
  lastDeliveryStatus: "ok" | "failed" | "pending" | null;
  lastDeliveredAt: string | null;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  link: string | null;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorType: "user" | "admin" | "system";
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type AdminRole =
  | "super_admin"
  | "support"
  | "billing"
  | "content"
  | "auditor";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  createdAt: string;
}

export interface StorageSnapshot {
  totalUsers: number;
  activeUsers: number;
  newSignups7d: number;
  totalFiles: number;
  storageUsedBytes: number;
  uploadVolume7d: number;
  downloadVolume7d: number;
  activeSubscriptions: number;
  mrrCents: number;
  apiRequests7d: number;
  systemHealth: {
    storage: "ok" | "degraded" | "down";
    api: "ok" | "degraded" | "down";
    cdn: "ok" | "degraded" | "down";
  };
}

/**
 * "gallery" is grid with a large preview: the picture is the point, so the card
 * leads with it instead of a 40px icon beside the name.
 */
export type ViewMode = "grid" | "list" | "gallery";
export type Theme = "light" | "dark";

// A short-lived, scope-limited upload grant returned by the server. The client
// uploads bytes directly to object storage using presignedUrl — never through
// the API server.
export interface UploadTicket {
  uploadId: string; // id the client echoes back when confirming the upload
  objectKey: string; // opaque, server-generated storage key
  presignedUrl: string; // direct PUT destination (B2 / S3)
  partSizeBytes: number; // suggested multipart part size
  expiresIn: number; // seconds until the grant is invalid
}
