// Repository contracts.
// These interfaces are the single boundary between the UI (React Query hooks)
// and the data layer. Phase 1 ships Mock* implementations (in-memory / local
// storage). Phase 2 ships Api* implementations that call api.cloudcols.com and
// implement the same interfaces — no UI component changes are required.

import type {
  ApiKey,
  ApiPlan,
  ApiRequestLog,
  AuditLog,
  File,
  FileCategory,
  FileListParams,
  FileListItem,
  Folder,
  Notification,
  Paginated,
  Payment,
  Plan,
  ShareInvitation,
  ShareLink,
  Subscription,
  UploadTicket,
  User,
  Webhook,
} from "@/lib/types";

export const MAX_RECORD = 1_000_000;

export interface FilesRepository {
  list(userId: string, params: FileListParams): Promise<Paginated<FileListItem>>;
  get(userId: string, id: string): Promise<File | null>;
  getChildren(userId: string, folderId: string | null, params?: FileListParams): Promise<Paginated<FileListItem>>;
  createFolder(userId: string, parentId: string | null, name: string): Promise<Folder>;
  renameFolder(userId: string, folderId: string, name: string): Promise<Folder>;
  moveToFolder(userId: string, ids: string[], targetFolderId: string | null): Promise<void>;
  rename(userId: string, fileId: string, name: string): Promise<File>;
  toggleFavorite(userId: string, fileId: string): Promise<File>;
  trash(userId: string, ids: string[]): Promise<void>;
  restore(userId: string, ids: string[]): Promise<void>;
  destroy(userId: string, ids: string[]): Promise<void>;
  /**
   * folderId is where the file belongs. It was missing, so a file uploaded while a
   * folder was open landed at the root instead — the folder the user was looking
   * at was never told about it.
   */
  createUploadTicket(
    userId: string,
    filename: string,
    sizeBytes: number,
    mimeType?: string,
    folderId?: string | null,
  ): Promise<UploadTicket>;
  confirmUpload(userId: string, uploadId: string, fileId: string): Promise<File>;
  listTrash(userId: string): Promise<Paginated<FileListItem>>;
  /** All top-level + nested folders for a user (flat list), for navigation/breadcrumbs. */
  listAllFolders(userId: string): Promise<Folder[]>;
  /** Favorite folders for the dashboard. */
  listFavoriteFolders(userId: string): Promise<Folder[]>;
  /** Folders most recently accessed, newest first. */
  listRecentFolders(userId: string): Promise<Folder[]>;
  /** Toggle a folder's favorite state. */
  toggleFolderFavorite(userId: string, folderId: string): Promise<Folder>;
  /** Pinned folders sort above everything else in their parent. */
  toggleFolderPin(userId: string, folderId: string): Promise<Folder>;
  /** An icon key, or null to go back to the default folder icon. */
  setFolderIcon(userId: string, folderId: string, icon: string | null): Promise<Folder>;
  /** Mark a file or folder as accessed (updates last_accessed_at). */
  markAccessed(userId: string, type: "file" | "folder", id: string): Promise<void>;
  /** Combined recent-access feed (files + folders), newest first. */
  recentAccess(userId: string, limit?: number): Promise<FileListItem[]>;
  /** Per-category byte totals (including trash if included). */
  usageSummary(userId: string): Promise<{ category: FileCategory; bytes: number; count: number }[]>;
  /**
   * A short-lived URL the browser can read the bytes from directly.
   *
   * Needed for previews and thumbnails as much as for downloads: without it the
   * UI had no way to reach a stored file, and the preview rendered a placeholder
   * with the filename drawn on it instead of the file.
   */
  getDownloadUrl(
    userId: string,
    fileId: string,
    disposition?: "inline" | "attachment",
  ): Promise<{ url: string; expiresIn: number; filename?: string }>;
}

export interface AuthRepository {
  getCurrentUser(): Promise<User | null>;
  signIn(email: string, password: string): Promise<User>;
  signUp(name: string, email: string, password: string): Promise<User>;
  signOut(): Promise<void>;
  updateProfile(userId: string, patch: Partial<User>): Promise<User>;
  changePlan(userId: string, planId: string): Promise<User>;
  deleteAccount(userId: string): Promise<void>;
}

export interface PlanRepository {
  list(): Promise<Plan[]>;
  listActive(): Promise<Plan[]>;
  get(id: string): Promise<Plan | null>;
}

export interface ShareRepository {
  /** Invite someone by email. Never reveals whether that address has an account. */
  invite(
    userId: string,
    opts: { fileId?: string | null; folderId?: string | null; email: string; permission?: "viewer" | "editor"; message?: string },
  ): Promise<ShareInvitation>;
  /** "incoming" is what was shared with me; "outgoing" is what I shared. */
  listInvitations(userId: string, direction: "incoming" | "outgoing"): Promise<ShareInvitation[]>;
  respondToInvitation(userId: string, id: string, action: "accept" | "decline" | "revoke"): Promise<void>;
  listByOwner(userId: string): Promise<ShareLink[]>;
  create(userId: string, opts: { fileId?: string; folderId?: string; permission: "view" | "download"; expiresAt?: string | null }): Promise<ShareLink>;
  revoke(userId: string, shareId: string): Promise<void>;
  resolve(token: string): Promise<{ share: ShareLink; file: File; folder: Folder | null } | null>;
}

export interface SubscriptionRepository {
  listForUser(userId: string): Promise<Subscription[]>;
  currentForUser(userId: string): Promise<Subscription | null>;
  /**
   * Starts a plan change. A paid plan answers with somewhere to pay, or refuses;
   * it never returns a subscription, because nothing is granted until a provider
   * confirms the payment.
   */
  checkout(
    userId: string,
    planId: string,
    provider: string,
  ): Promise<{ status: "applied"; planId: string; checkoutUrl: string | null }>;
  cancel(userId: string): Promise<Subscription>;
}

export interface DeveloperRepository {
  apiPlans(): Promise<ApiPlan[]>;
  keys(userId: string): Promise<ApiKey[]>;
  createKey(userId: string, label: string, scopes: string[]): Promise<{ key: ApiKey; secret: string }>;
  revokeKey(userId: string, keyId: string): Promise<void>;
  usage(userId: string, days?: number): Promise<Paginated<ApiRequestLog>>;
  webhooks(userId: string): Promise<Webhook[]>;
  createWebhook(userId: string, url: string, events: string[]): Promise<Webhook>;
  updateWebhook(userId: string, id: string, patch: Partial<Webhook>): Promise<Webhook>;
  deleteWebhook(userId: string, id: string): Promise<void>;
}

export interface NotificationRepository {
  list(userId: string): Promise<Notification[]>;
  unreadCount(userId: string): Promise<number>;
  markRead(userId: string, id: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
}

export interface AdminRepository {
  stats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    newSignups7d: number;
    totalFiles: number;
    storageUsedBytes: number;
    activeSubscriptions: number;
    mrrCents: number;
    apiRequests7d: number;
  }>;
  users(): Promise<User[]>;
  accounts(): Promise<User[]>;
  payments(): Promise<Payment[]>;
  plans(): Promise<Plan[]>;
  auditLogs(): Promise<AuditLog[]>;
}
