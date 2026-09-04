"use client";

// API-backed repositories implementing the same contracts as the mock repos.
// They call `/api/*` route handlers, which validate Supabase sessions and
// issue short-lived B2 presigned URLs. Swapping `lib/hooks/queries.ts` to these
// modules turns the app from mock data to a live backend with NO UI changes.

import type {
  File,
  FileListParams,
  FileListItem,
  Folder,
  Paginated,
  Plan,
  ShareInvitation,
  ShareLink,
  Subscription,
  UploadTicket,
  User,
  Webhook,
  ApiKey,
  ApiPlan,
  ApiRequestLog,
  Payment,
  AuditLog,
  Notification,
} from "@/lib/types";
import type {
  AdminRepository,
  AuthRepository,
  DeveloperRepository,
  FilesRepository,
  NotificationRepository,
  PlanRepository,
  ShareRepository,
  SubscriptionRepository,
} from "../types";
import { apiClient, auth } from "@/lib/api/client";

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
class ApiAuthRepository implements AuthRepository {
  private async resolveCurrent(userId: string, email: string): Promise<User> {
    const profile = await apiClient.get<Record<string, unknown>>("/api/auth/me");
    return {
      id: userId,
      email,
      name: email.split("@")[0] ?? "User",
      username: (email.split("@")[0] ?? "user").replace(/[^a-z0-9]/gi, ""),
      avatarUrl: null,
      // /api/auth/me answers in camelCase. Reading snake_case here meant every
      // field fell back to its default, so storage always showed 0 B used however
      // much had been uploaded, and the plan always read as free.
      planId: String(profile.planId ?? "plan_free"),
      storageUsedBytes: Number(profile.storageUsedBytes ?? 0),
      storageQuotaBytes: Number(profile.storageQuotaBytes ?? 5 * 1024 * 1024 * 1024),
      role: "user",
      developerEnabled: Boolean(profile.developerEnabled),
      status: (profile.status as User["status"]) ?? "active",
      createdAt: String(profile.createdAt ?? new Date().toISOString()),
      lastLoginAt: String(profile.lastLoginAt ?? new Date().toISOString()),
    };
  }

  async getCurrentUser(): Promise<User | null> {
    const sb = auth();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    return this.resolveCurrent(data.session.user.id, data.session.user.email ?? "");
  }

  async signIn(email: string, password: string): Promise<User> {
    const sb = auth();
    if (!sb) throw new Error("Supabase not configured on this deployment.");
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return this.resolveCurrent(data.user.id, data.user.email ?? "");
  }

  async signUp(name: string, email: string, password: string): Promise<User> {
    const sb = auth();
    if (!sb) throw new Error("Supabase not configured on this deployment.");
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error("Account created; check your email to verify.");
    // If auto-confirm is on we get a session; otherwise sentinel user until verified.
    return this.resolveCurrent(data.user.id, data.user.email ?? "");
  }

  async signOut(): Promise<void> {
    const sb = auth();
    if (sb) await sb.auth.signOut();
  }

  async updateProfile(userId: string, patch: Partial<User>): Promise<User> {
    // Persist editable profile fields via the server, then return the fresh profile.
    return apiClient.patch<User>("/api/profile", { name: patch.name, avatarUrl: patch.avatarUrl });
  }

  async changePlan(userId: string, planId: string): Promise<User> {
    // In Phase 2, plan changes are applied via a subscription/billing endpoint.
    await apiClient.post<{ ok: boolean }>("/api/plan/change", { planId });
    return this.resolveCurrent(userId, userId);
  }

  async deleteAccount(userId: string): Promise<void> {
    await apiClient.post("/api/auth/delete");
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
class ApiFilesRepository implements FilesRepository {
  async list(userId: string, params: FileListParams = {}): Promise<Paginated<FileListItem>> {
    return apiClient.get<Paginated<FileListItem>>(`/api/files${qs({ ...params, folderId: null })}`);
  }
  async get(userId: string, id: string): Promise<File | null> {
    return apiClient.get<File | null>(`/api/files/${id}`);
  }
  async getChildren(userId: string, folderId: string | null, params: FileListParams = {}): Promise<Paginated<FileListItem>> {
    return apiClient.get<Paginated<FileListItem>>(`/api/files${qs({ folderId, ...params })}`);
  }
  async createFolder(userId: string, parentId: string | null, name: string): Promise<Folder> {
    return apiClient.post<Folder>("/api/folders", { parentId, name });
  }
  async renameFolder(userId: string, folderId: string, name: string): Promise<Folder> {
    return apiClient.patch<Folder>(`/api/folders/${folderId}`, { name });
  }
  async moveToFolder(userId: string, ids: string[], targetFolderId: string | null): Promise<void> {
    await Promise.all(ids.map((id) => apiClient.patch(`/api/files/${id}`, { folderId: targetFolderId })));
  }
  async rename(userId: string, fileId: string, name: string): Promise<File> {
    return apiClient.patch<File>(`/api/files/${fileId}`, { originalFilename: name });
  }
  async toggleFavorite(userId: string, fileId: string): Promise<File> {
    const file = await apiClient.get<File>(`/api/files/${fileId}`);
    return apiClient.patch<File>(`/api/files/${fileId}`, { isFavorite: !file.isFavorite });
  }
  async trash(userId: string, ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => apiClient.del(`/api/files/${id}`)));
  }
  async restore(userId: string, ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => apiClient.post(`/api/files/${id}/restore`)));
  }
  async destroy(userId: string, ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => apiClient.del(`/api/files/${id}?force=true`)));
  }
  async createUploadTicket(
    userId: string,
    filename: string,
    sizeBytes: number,
    mimeType?: string,
    folderId?: string | null,
  ): Promise<UploadTicket> {
    // The real type so the server derives the category correctly, and the folder so
    // the file lands where the user is looking.
    return apiClient.post<UploadTicket>("/api/files/upload-ticket", {
      filename,
      sizeBytes,
      mimeType,
      folderId: folderId ?? null,
    });
  }
  async confirmUpload(userId: string, uploadId: string, fileId: string): Promise<File> {
    return apiClient.post<File>("/api/files/confirm", { uploadId, fileId });
  }
  async getDownloadUrl(
    userId: string,
    fileId: string,
    disposition: "inline" | "attachment" = "inline",
  ): Promise<{ url: string; expiresIn: number; filename?: string }> {
    const res = await apiClient.get<{ presignedUrl: string; expiresIn: number; filename?: string }>(
      `/api/files/download?fileId=${encodeURIComponent(fileId)}&disposition=${disposition}`,
    );
    return { url: res.presignedUrl, expiresIn: res.expiresIn, filename: res.filename };
  }
  async listTrash(userId: string): Promise<Paginated<FileListItem>> {
    return apiClient.get<Paginated<FileListItem>>("/api/files/trash");
  }
  async listAllFolders(userId: string): Promise<Folder[]> {
    return apiClient.get<Folder[]>("/api/folders");
  }
  async listFavoriteFolders(userId: string): Promise<Folder[]> {
    return apiClient.get<Folder[]>("/api/folders?favorite=true");
  }
  async listRecentFolders(userId: string): Promise<Folder[]> {
    return apiClient.get<Folder[]>("/api/folders?recent=true");
  }
  async toggleFolderFavorite(userId: string, folderId: string): Promise<Folder> {
    return apiClient.patch<Folder>(`/api/folders/${folderId}`, { toggleFavorite: true });
  }
  async toggleFolderPin(userId: string, folderId: string): Promise<Folder> {
    // Toggled server-side so the client does not have to hold current state and
    // cannot get it wrong after a stale read.
    return apiClient.patch<Folder>(`/api/folders/${folderId}`, { togglePin: true });
  }
  async setFolderIcon(userId: string, folderId: string, icon: string | null): Promise<Folder> {
    return apiClient.patch<Folder>(`/api/folders/${folderId}`, { icon });
  }
  async markAccessed(userId: string, type: "file" | "folder", id: string): Promise<void> {
    await apiClient.post("/api/recent", { type, id });
  }
  async recentAccess(userId: string, limit = 10): Promise<FileListItem[]> {
    return apiClient.get<{ items: FileListItem[] }>(`/api/recent?limit=${limit}`).then((r) => r.items);
  }
  async usageSummary(userId: string): Promise<{ category: File["category"]; bytes: number; count: number }[]> {
    return apiClient.get<{ category: File["category"]; bytes: number; count: number }[]>("/api/files/usage");
  }
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
class ApiPlanRepository implements PlanRepository {
  async list() { return apiClient.get<Plan[]>("/api/plans"); }
  async listActive() { return apiClient.get<Plan[]>("/api/plans"); }
  async get(id: string) { return apiClient.get<Plan>(`/api/plans/${id}`); }
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------
class ApiShareRepository implements ShareRepository {
  async listByOwner(userId: string) { return apiClient.get<ShareLink[]>("/api/shares"); }
  async invite(
    userId: string,
    opts: { fileId?: string | null; folderId?: string | null; email: string; permission?: "viewer" | "editor"; message?: string },
  ): Promise<ShareInvitation> {
    return apiClient.post<ShareInvitation>("/api/shares/invitations", opts);
  }
  async listInvitations(userId: string, direction: "incoming" | "outgoing"): Promise<ShareInvitation[]> {
    return apiClient.get<ShareInvitation[]>(`/api/shares/invitations?direction=${direction}`);
  }
  async respondToInvitation(userId: string, id: string, action: "accept" | "decline" | "revoke"): Promise<void> {
    await apiClient.patch(`/api/shares/invitations/${id}`, { action });
  }
  async create(userId: string, opts: { fileId?: string; folderId?: string; permission: "view" | "download"; expiresAt?: string | null }) {
    return apiClient.post<ShareLink>("/api/shares", opts);
  }
  async revoke(userId: string, shareId: string) { await apiClient.patch(`/api/shares/${shareId}`, { isRevoked: true }); }
  async resolve(token: string) { return apiClient.get<{ share: ShareLink; file: File; folder: Folder | null }>(`/api/shares/resolve?token=${token}`); }
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
class ApiSubscriptionRepository implements SubscriptionRepository {
  async listForUser(userId: string) { return apiClient.get<Subscription[]>("/api/subscriptions"); }
  async currentForUser(userId: string) { return apiClient.get<Subscription | null>("/api/subscriptions/current"); }
  async checkout(userId: string, planId: string, provider: string) {
    // A paid plan answers with somewhere to pay, or refuses. It never returns a
    // subscription, because nothing is granted until a provider confirms payment.
    return apiClient.post<{ status: "applied"; planId: string; checkoutUrl: string | null }>(
      "/api/subscriptions/checkout",
      { planId, provider },
    );
  }
  async cancel(userId: string) { return apiClient.post<Subscription>("/api/subscriptions/cancel"); }
}

// ---------------------------------------------------------------------------
// Developer
// ---------------------------------------------------------------------------
class ApiDeveloperRepository implements DeveloperRepository {
  async apiPlans() { return apiClient.get<ApiPlan[]>("/api/dev/api-plans"); }
  async keys(userId: string) { return apiClient.get<ApiKey[]>("/api/dev/keys"); }
  async createKey(userId: string, label: string, scopes: string[]) { return apiClient.post<{ key: ApiKey; secret: string }>("/api/dev/keys", { label, scopes }); }
  async revokeKey(userId: string, keyId: string) { await apiClient.patch(`/api/dev/keys/${keyId}`, { status: "revoked" }); }
  async usage(userId: string, days = 7) { return apiClient.get<Paginated<ApiRequestLog>>(`/api/dev/usage?days=${days}`); }
  async webhooks(userId: string) { return apiClient.get<Webhook[]>("/api/dev/webhooks"); }
  async createWebhook(userId: string, url: string, events: string[]) { return apiClient.post<Webhook>("/api/dev/webhooks", { url, events }); }
  async updateWebhook(userId: string, id: string, patch: Partial<Webhook>) { return apiClient.patch<Webhook>(`/api/dev/webhooks/${id}`, patch); }
  async deleteWebhook(userId: string, id: string) { await apiClient.del(`/api/dev/webhooks/${id}`); }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
class ApiNotificationRepository implements NotificationRepository {
  async list(userId: string) { return apiClient.get<Notification[]>("/api/notifications"); }
  async unreadCount(userId: string) { return apiClient.get<{ count: number }>("/api/notifications/unread").then((r) => r.count); }
  async markRead(userId: string, id: string) { await apiClient.patch(`/api/notifications/${id}`, { isRead: true }); }
  async markAllRead(userId: string) { await apiClient.post("/api/notifications/mark-all-read"); }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
class ApiAdminRepository implements AdminRepository {
  async stats() {
    return apiClient.get<{
      totalUsers: number; activeUsers: number; newSignups7d: number; totalFiles: number;
      storageUsedBytes: number; activeSubscriptions: number; mrrCents: number; apiRequests7d: number;
    }>("/api/admin/stats");
  }
  async users() { return apiClient.get<User[]>("/api/admin/users"); }
  async accounts() { return apiClient.get<User[]>("/api/admin/users"); }
  async payments() { return apiClient.get<Payment[]>("/api/admin/payments"); }
  async plans() { return apiClient.get<Plan[]>("/api/plans"); }
  async auditLogs() { return apiClient.get<AuditLog[]>("/api/admin/audit"); }
}

// ---------------------------------------------------------------------------
// Export singletons
// ---------------------------------------------------------------------------
export const apiFilesRepo: FilesRepository = new ApiFilesRepository();
export const apiAuthRepo: AuthRepository = new ApiAuthRepository();
export const apiPlanRepo: PlanRepository = new ApiPlanRepository();
export const apiShareRepo: ShareRepository = new ApiShareRepository();
export const apiSubscriptionRepo: SubscriptionRepository = new ApiSubscriptionRepository();
export const apiDeveloperRepo: DeveloperRepository = new ApiDeveloperRepository();
export const apiNotificationRepo: NotificationRepository = new ApiNotificationRepository();
export const apiAdminRepo: AdminRepository = new ApiAdminRepository();
