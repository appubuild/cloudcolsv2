// Mock repositories.
// Simulate the real API: realistic latency, ownership validation, quota checks,
// category derivation, and occasional error injection so every UI state
// (loading / empty / error / permission-denied) is exercisable in Phase 1.

import { getDb, saveDb } from "@/lib/mock/db";
import type { File, FileCategory, FileListParams, FileListItem, Folder, User, Webhook } from "@/lib/types";
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
import { CATEGORY_EXT } from "@/data/seed";
import { uuid } from "@/lib/utils";

const LATENCY_MS = 300;
const ERROR_RATE = 0.0; // 0–1. Set >0 to exercise error states during development.

function delay(ms: number = LATENCY_MS): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function maybeThrow(): void {
  if (ERROR_RATE > 0 && Math.random() < ERROR_RATE) {
    throw new Error("Service temporarily unavailable. Please retry.");
  }
}

export class CloudColsError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function requireUser(db: ReturnType<typeof getDb>, userId: string): User {
  const user = db.users.find((u) => u.id === userId);
  if (!user) throw new CloudColsError("UNAUTHORIZED", 401, "Not authenticated.");
  if (user.status === "suspended")
    throw new CloudColsError("ACCOUNT_SUSPENDED", 403, "This account is suspended.");
  return user;
}

// Derive the backend-authoritative category from MIME type + extension.
export function deriveCategory(mime: string, filename: string): FileCategory {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  if (m.includes("document") || m.includes("officedocument") || m.includes("text/") || m === "application/json" || m === "application/xml") {
    return "document";
  }
  if (m === "application/zip" || m === "application/x-rar-compressed" || m === "application/x-7z-compressed" || m === "application/gzip" || m === "application/x-tar") {
    return "archive";
  }
  if (["txt", "csv", "md", "svg"].includes(ext)) return "document";
  return "other";
}

function itemName(item: File | Folder): string {
  return "name" in item ? item.name : item.originalFilename;
}

function sortItems(items: (File | Folder)[], sort: string, order: string): (File | Folder)[] {
  const dir = order === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    if (sort === "size") {
      const as = "sizeBytes" in a ? a.sizeBytes : 0;
      const bs = "sizeBytes" in b ? b.sizeBytes : 0;
      return (as - bs) * dir;
    }
    if (sort === "modified") {
      const ad = new Date(a.updatedAt).getTime();
      const bd = new Date(b.updatedAt).getTime();
      return (ad - bd) * dir;
    }
    if (sort === "accessed") {
      const ad = "lastAccessedAt" in a && a.lastAccessedAt ? new Date(a.lastAccessedAt).getTime() : 0;
      const bd = "lastAccessedAt" in b && b.lastAccessedAt ? new Date(b.lastAccessedAt).getTime() : 0;
      return (ad - bd) * dir;
    }
    if (sort === "favorite") {
      const af = "isFavorite" in a ? (a.isFavorite ? 1 : 0) : 0;
      const bf = "isFavorite" in b ? (b.isFavorite ? 1 : 0) : 0;
      return (af - bf) * dir;
    }
    // default: name
    return itemName(a).localeCompare(itemName(b)) * dir;
  });
}

function paginate<T>(items: T[], page: number, pageSize: number): { items: T[]; total: number } {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
class MockFilesRepository implements FilesRepository {
  private match(params: FileListParams, file: File, folder: Folder | undefined, userId: string): boolean {
    if (file.ownerId !== userId) return false;
    if (folder && folder.ownerId !== userId) return false;
    if (params.trashed) {
      if (!file.trashedAt) return false;
    } else {
      if (file.trashedAt) return false;
    }
    if (params.folderId !== undefined) {
      if (file.folderId !== params.folderId) return false;
    }
    if (params.category && file.category !== params.category) return false;
    if (params.favoritesOnly && !file.isFavorite) return false;
    if (params.search) {
      const q = params.search.toLowerCase();
      if (!file.originalFilename.toLowerCase().includes(q)) return false;
    }
    if (params.recent && !file.lastAccessedAt) return false;
    return true;
  }

  async list(userId: string, params: FileListParams = {}) {
    await delay();
    maybeThrow();
    const db = getDb();
    requireUser(db, userId);
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 24;
    const items = db.files
      .filter((f) => this.match(params, f, undefined, userId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const { items: pageItems, total } = paginate(items, page, pageSize);
    return { items: pageItems, total, page, pageSize };
  }

  async getChildren(userId: string, folderId: string | null, params: FileListParams = {}) {
    await delay();
    maybeThrow();
    const db = getDb();
    requireUser(db, userId);
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 36;
    const folders = db.folders.filter((fo) => fo.ownerId === userId && !fo.trashedAt && fo.parentId === folderId);
    const folderIds = new Set(folders.map((f) => f.id));
    const files = db.files.filter((f) => f.ownerId === userId && !f.trashedAt && f.folderId === folderId && this.match(params, f, undefined, userId));
    // only include folders when not searching / categorifying
    const includeFolders = !params.search && !params.category && !params.favoritesOnly && !params.recent;
    const combined: FileListItem[] = includeFolders ? [...folders, ...files] : [...files];
    const sorted = sortItems(combined, params.sort ?? "name", params.order ?? "asc");
    const { items: pageItems, total } = paginate(sorted, page, pageSize);
    return { items: pageItems, total, page, pageSize };
  }

  async get(userId: string, id: string) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    const file = db.files.find((f) => f.id === id);
    if (!file || file.ownerId !== userId) throw new CloudColsError("FILE_NOT_FOUND", 404, "File not found.");
    return file;
  }

  async createFolder(userId: string, parentId: string | null, name: string) {
    await delay();
    maybeThrow();
    const db = getDb();
    requireUser(db, userId);
    const trimmed = name.trim();
    if (!trimmed) throw new CloudColsError("INVALID_NAME", 400, "Folder name is required.");
    if (trimmed.length > 120) throw new CloudColsError("INVALID_NAME", 400, "Folder name is too long.");
    const parent = parentId ? db.folders.find((f) => f.id === parentId) : null;
    if (parentId && !parent) throw new CloudColsError("FOLDER_NOT_FOUND", 404, "Parent folder not found.");
    const path = parent ? `${parent.path} / ${trimmed}` : trimmed;
    const folder: Folder = {
      id: `folder_${uuid()}`,
      ownerId: userId,
      parentId,
      name: trimmed,
      path,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      trashedAt: null,
      isFavorite: false,
      isPinned: false,
      icon: null,
      lastAccessedAt: null,
    };
    db.folders.push(folder);
    saveDb();
    return folder;
  }

  async renameFolder(userId: string, folderId: string, name: string) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    const folder = db.folders.find((f) => f.id === folderId);
    if (!folder || folder.ownerId !== userId) throw new CloudColsError("FOLDER_NOT_FOUND", 404, "Folder not found.");
    folder.name = name.trim();
    folder.updatedAt = new Date().toISOString();
    saveDb();
    return folder;
  }

  async moveToFolder(userId: string, ids: string[], targetFolderId: string | null) {
    await delay();
    maybeThrow();
    const db = getDb();
    requireUser(db, userId);
    for (const id of ids) {
      const file = db.files.find((f) => f.id === id);
      if (file && file.ownerId === userId) {
        file.folderId = targetFolderId;
        file.updatedAt = new Date().toISOString();
      }
      const folder = db.folders.find((f) => f.id === id);
      if (folder && folder.ownerId === userId) {
        folder.parentId = targetFolderId;
        folder.updatedAt = new Date().toISOString();
      }
    }
    saveDb();
  }

  async rename(userId: string, fileId: string, name: string) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    const file = db.files.find((f) => f.id === fileId);
    if (!file || file.ownerId !== userId) throw new CloudColsError("FILE_NOT_FOUND", 404, "File not found.");
    file.originalFilename = name.trim();
    file.updatedAt = new Date().toISOString();
    saveDb();
    return file;
  }

  async toggleFavorite(userId: string, fileId: string) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    const file = db.files.find((f) => f.id === fileId);
    if (!file || file.ownerId !== userId) throw new CloudColsError("FILE_NOT_FOUND", 404, "File not found.");
    file.isFavorite = !file.isFavorite;
    file.updatedAt = new Date().toISOString();
    saveDb();
    return file;
  }

  async trash(userId: string, ids: string[]) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    const now = new Date().toISOString();
    for (const id of ids) {
      const file = db.files.find((f) => f.id === id);
      if (file && file.ownerId === userId) {
        file.trashedAt = now;
        file.updatedAt = now;
      }
      const folder = db.folders.find((f) => f.id === id);
      if (folder && folder.ownerId === userId) folder.trashedAt = now;
    }
    saveDb();
  }

  async restore(userId: string, ids: string[]) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    for (const id of ids) {
      const file = db.files.find((f) => f.id === id);
      if (file && file.ownerId === userId) file.trashedAt = null;
      const folder = db.folders.find((f) => f.id === id);
      if (folder && folder.ownerId === userId) folder.trashedAt = null;
    }
    saveDb();
  }

  async destroy(userId: string, ids: string[]) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    for (const id of ids) {
      const fileIdx = db.files.findIndex((f) => f.id === id);
      if (fileIdx >= 0 && db.files[fileIdx].ownerId === userId) db.files.splice(fileIdx, 1);
      const folderIdx = db.folders.findIndex((f) => f.id === id);
      if (folderIdx >= 0 && db.folders[folderIdx].ownerId === userId) db.folders.splice(folderIdx, 1);
    }
    saveDb();
  }

  async createUploadTicket(userId: string, filename: string, sizeBytes: number, mimeType?: string, folderId?: string | null) {
    await delay();
    const db = getDb();
    const user = requireUser(db, userId);
    // Server-side quota enforcement — never trust the client.
    const quota = user.storageQuotaBytes;
    const used = user.storageUsedBytes;
    if (used + sizeBytes > quota) {
      throw new CloudColsError("QUOTA_EXCEEDED", 413, "Storage quota exceeded. Upgrade your plan to continue.");
    }
    const plan = db.plans.find((p) => p.id === user.planId);
    if (plan && sizeBytes > plan.maxFileSizeBytes) {
      throw new CloudColsError("FILE_TOO_LARGE", 413, `File exceeds the ${Math.round(plan.maxFileSizeBytes / 1e6)} MB limit for your plan.`);
    }
    const cat = deriveCategory(mimeType ?? "", filename);
    const ext = (filename.split(".").pop() || "bin").toLowerCase();
    const objectKey = `${userId}/user-files/${cat}/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/CC-${uuid()}.${ext}`;
    // Simulated presigned URL (in production this points at Backblaze B2).
    const presignedUrl = `https://sim.invalid/presigned/${encodeURIComponent(objectKey)}?X-Amz-Signature=MOCK`;
    return {
      uploadId: `up_${uuid()}`,
      objectKey,
      presignedUrl,
      partSizeBytes: 10 * 1024 * 1024,
      expiresIn: 900,
    };
  }

  async confirmUpload(userId: string, uploadId: string, fileId: string) {
    await delay();
    const db = getDb();
    const user = requireUser(db, userId);
    const file = db.files.find((f) => f.id === fileId);
    if (!file) throw new CloudColsError("FILE_NOT_FOUND", 404, "File not found.");
    file.status = "ready";
    // Recompute category from authoritative MIME/extension (never trust client).
    file.category = deriveCategory(file.mimeType, file.originalFilename);
    user.storageUsedBytes += file.sizeBytes;
    saveDb();
    return file;
  }

  async listTrash(userId: string) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    const folders = db.folders.filter((fo) => fo.ownerId === userId && fo.trashedAt);
    const files = db.files.filter((f) => f.ownerId === userId && f.trashedAt);
    const combined = sortItems([...folders, ...files], "modified", "desc") as FileListItem[];
    return { items: combined, total: combined.length, page: 1, pageSize: 100 };
  }

  async listAllFolders(userId: string) {
    await delay(150);
    const db = getDb();
    requireUser(db, userId);
    return db.folders.filter((f) => f.ownerId === userId && !f.trashedAt);
  }

  async listFavoriteFolders(userId: string) {
    await delay(120);
    const db = getDb();
    requireUser(db, userId);
    return db.folders.filter((f) => f.ownerId === userId && !f.trashedAt && f.isFavorite).sort((a, b) => a.name.localeCompare(b.name));
  }

  async listRecentFolders(userId: string) {
    await delay(120);
    const db = getDb();
    requireUser(db, userId);
    return db.folders
      .filter((f) => f.ownerId === userId && !f.trashedAt && f.lastAccessedAt)
      .sort((a, b) => (b.lastAccessedAt ?? "").localeCompare(a.lastAccessedAt ?? ""))
      .slice(0, 8);
  }

  async toggleFolderFavorite(userId: string, folderId: string) {
    await delay(120);
    const db = getDb();
    requireUser(db, userId);
    const folder = db.folders.find((f) => f.id === folderId);
    if (!folder || folder.ownerId !== userId) throw new CloudColsError("FOLDER_NOT_FOUND", 404, "Folder not found.");
    folder.isFavorite = !folder.isFavorite;
    folder.updatedAt = new Date().toISOString();
    saveDb();
    return folder;
  }

  async toggleFolderPin(userId: string, folderId: string) {
    await delay(120);
    const db = getDb();
    requireUser(db, userId);
    const folder = db.folders.find((f) => f.id === folderId);
    if (!folder || folder.ownerId !== userId) throw new CloudColsError("FOLDER_NOT_FOUND", 404, "Folder not found.");
    folder.isPinned = !folder.isPinned;
    folder.updatedAt = new Date().toISOString();
    saveDb();
    return folder;
  }

  async setFolderIcon(userId: string, folderId: string, icon: string | null) {
    await delay(120);
    const db = getDb();
    requireUser(db, userId);
    const folder = db.folders.find((f) => f.id === folderId);
    if (!folder || folder.ownerId !== userId) throw new CloudColsError("FOLDER_NOT_FOUND", 404, "Folder not found.");
    folder.icon = icon;
    folder.updatedAt = new Date().toISOString();
    saveDb();
    return folder;
  }

  async markAccessed(userId: string, type: "file" | "folder", id: string) {
    const db = getDb();
    requireUser(db, userId);
    const now = new Date().toISOString();
    if (type === "file") {
      const f = db.files.find((x) => x.id === id);
      if (f && f.ownerId === userId) f.lastAccessedAt = now;
    } else {
      const f = db.folders.find((x) => x.id === id);
      if (f && f.ownerId === userId) f.lastAccessedAt = now;
    }
    saveDb();
  }

  async recentAccess(userId: string, limit = 10) {
    await delay(120);
    const db = getDb();
    requireUser(db, userId);
    const items: FileListItem[] = [
      ...db.files.filter((f) => f.ownerId === userId && !f.trashedAt && f.lastAccessedAt),
      ...db.folders.filter((f) => f.ownerId === userId && !f.trashedAt && f.lastAccessedAt),
    ];
    return items.sort((a, b) => ((b as any).lastAccessedAt ?? "").localeCompare((a as any).lastAccessedAt ?? "")).slice(0, limit);
  }

  async usageSummary(userId: string) {
    await delay(200);
    const db = getDb();
    requireUser(db, userId);
    const files = db.files.filter((f) => f.ownerId === userId && !f.trashedAt);
    const byCat = new Map<FileCategory, { bytes: number; count: number }>();
    files.forEach((f) => {
      const cur = byCat.get(f.category) ?? { bytes: 0, count: 0 };
      cur.bytes += f.sizeBytes;
      cur.count += 1;
      byCat.set(f.category, cur);
    });
    const order: FileCategory[] = ["image", "video", "audio", "pdf", "document", "archive", "other"];
    return order
      .filter((c) => byCat.has(c))
      .map((c) => ({ category: c, ...byCat.get(c)! }));
  }

  /**
   * There are no stored bytes in mock mode, so there is no URL to hand out.
   * Refusing is the honest answer: callers show their fallback rather than
   * pointing an <img> at something that will never load.
   */
  async getDownloadUrl(): Promise<{ url: string; expiresIn: number }> {
    await delay(120);
    throw new CloudColsError("NOT_AVAILABLE", 404, "File contents are not available with mock data.");
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
class MockAuthRepository implements AuthRepository {
  private sessionKey = "cloudcols.session.v1";
  get userId(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(this.sessionKey);
  }
  set userId(v: string | null) {
    if (typeof window === "undefined") return;
    if (v) window.localStorage.setItem(this.sessionKey, v);
    else window.localStorage.removeItem(this.sessionKey);
  }

  async getCurrentUser() {
    await delay(150);
    const id = this.userId;
    if (!id) return null;
    const db = getDb();
    const user = db.users.find((u) => u.id === id);
    return user ?? null;
  }

  async signIn(email: string, password: string) {
    await delay();
    maybeThrow();
    const db = getDb();
    const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    // Mock acceptance: any password for seeded users, or a demo account.
    if (!user) {
      if (email === "demo@cloudcols.com" && password === "demo1234") {
        const demo = db.users.find((u) => u.id === "user_pro")!;
        this.userId = demo.id;
        demo.lastLoginAt = new Date().toISOString();
        saveDb();
        return demo;
      }
      throw new CloudColsError("INVALID_CREDENTIALS", 401, "Invalid email or password.");
    }
    this.userId = user.id;
    user.lastLoginAt = new Date().toISOString();
    saveDb();
    return user;
  }

  async signUp(name: string, email: string, password: string) {
    await delay();
    const db = getDb();
    if (!name.trim()) throw new CloudColsError("INVALID_INPUT", 400, "Name is required.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new CloudColsError("INVALID_INPUT", 400, "Enter a valid email.");
    if (password.length < 8) throw new CloudColsError("WEAK_PASSWORD", 400, "Password must be at least 8 characters.");
    if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
      throw new CloudColsError("EMAIL_TAKEN", 409, "An account with this email already exists.");
    const freePlan = db.plans.find((p) => p.id === "plan_free")!;
    const user: User = {
      id: `u_${uuid()}`,
      email,
      name: name.trim(),
      username: name.trim().toLowerCase().replace(/\s+/g, "."),
      avatarUrl: null,
      planId: "plan_free",
      storageUsedBytes: 0,
      storageQuotaBytes: freePlan.storageQuotaBytes,
      role: "user",
      developerEnabled: false,
      status: "active",
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    db.users.push(user);
    this.userId = user.id;
    saveDb();
    return user;
  }

  async signOut() {
    await delay(120);
    this.userId = null;
  }

  async updateProfile(userId: string, patch: Partial<User>) {
    await delay();
    const db = getDb();
    const user = requireUser(db, userId);
    Object.assign(user, patch);
    saveDb();
    return user;
  }

  async changePlan(userId: string, planId: string) {
    await delay();
    const db = getDb();
    const user = requireUser(db, userId);
    const plan = db.plans.find((p) => p.id === planId);
    if (!plan) throw new CloudColsError("PLAN_NOT_FOUND", 404, "Plan not found.");
    user.planId = planId;
    user.storageQuotaBytes = plan.storageQuotaBytes;
    saveDb();
    return user;
  }

  async deleteAccount(userId: string) {
    await delay();
    const db = getDb();
    const idx = db.users.findIndex((u) => u.id === userId);
    if (idx >= 0) {
      db.users.splice(idx, 1);
      db.files = db.files.filter((f) => f.ownerId !== userId);
      db.folders = db.folders.filter((f) => f.ownerId !== userId);
      saveDb();
    }
    this.userId = null;
  }
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
class MockPlanRepository implements PlanRepository {
  async list() {
    await delay();
    maybeThrow();
    return getDb().plans;
  }
  async listActive() {
    await delay();
    return getDb().plans.filter((p) => p.isActive);
  }
  async get(id: string) {
    await delay(100);
    return getDb().plans.find((p) => p.id === id) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------
class MockShareRepository implements ShareRepository {
  async listByOwner(userId: string) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    return db.shares.filter((s) => s.ownerId === userId);
  }
  async create(userId: string, opts: { fileId?: string; folderId?: string; permission: "view" | "download"; expiresAt?: string | null }) {
    await delay();
    maybeThrow();
    const db = getDb();
    requireUser(db, userId);
    const token = Math.random().toString(36).slice(2, 12);
    const share = {
      id: `share_${uuid()}`,
      ownerId: userId,
      fileId: opts.fileId ?? null,
      folderId: opts.folderId ?? null,
      token,
      permission: opts.permission,
      expiresAt: opts.expiresAt ?? null,
      isRevoked: false,
      createdAt: new Date().toISOString(),
      accessCount: 0,
    };
    db.shares.push(share);
    saveDb();
    return share;
  }
  async revoke(userId: string, shareId: string) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    const share = db.shares.find((s) => s.id === shareId);
    if (share && share.ownerId === userId) {
      share.isRevoked = true;
      saveDb();
    }
  }
  async resolve(token: string) {
    await delay(150);
    const db = getDb();
    const share = db.shares.find((s) => s.token === token);
    if (!share) return null;
    if (share.isRevoked) throw new CloudColsError("SHARE_REVOKED", 410, "This link is no longer available.");
    if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now())
      throw new CloudColsError("SHARE_EXPIRED", 410, "This link has expired.");
    const file = share.fileId ? db.files.find((f) => f.id === share.fileId) : null;
    const folder = share.folderId ? db.folders.find((f) => f.id === share.folderId) : null;
    if (!file && !folder) throw new CloudColsError("SHARE_NOT_FOUND", 404, "This link is no longer available.");
    share.accessCount += 1;
    saveDb();
    return { share, file: file!, folder: folder ?? null };
  }
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
class MockSubscriptionRepository implements SubscriptionRepository {
  async listForUser(userId: string) {
    await delay();
    return getDb().subscriptions.filter((s) => s.userId === userId);
  }
  async currentForUser(userId: string) {
    await delay(100);
    const db = getDb();
    requireUser(db, userId);
    const sub = db.subscriptions.find((s) => s.userId === userId && s.status === "active");
    return sub ?? null;
  }
  async checkout(userId: string, planId: string, provider: string) {
    await delay(600);
    maybeThrow();
    const db = getDb();
    const user = requireUser(db, userId);
    const plan = db.plans.find((p) => p.id === planId);
    if (!plan) throw new CloudColsError("PLAN_NOT_FOUND", 404, "Plan not found.");
    user.planId = planId;
    user.storageQuotaBytes = plan.storageQuotaBytes;
    const sub = {
      id: `sub_${uuid()}`,
      userId,
      planId,
      status: "active" as const,
      provider,
      startedAt: new Date().toISOString(),
      renewsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      cancelledAt: null,
    };
    const payment = {
      id: `pay_${uuid()}`,
      userId,
      subscriptionId: sub.id,
      amountCents: plan.priceCents,
      currency: "USD",
      provider,
      status: "succeeded" as const,
      createdAt: new Date().toISOString(),
    };
    db.subscriptions.push(sub);
    db.payments.push(payment);
    saveDb();
    return { subscription: sub, payment };
  }
  async cancel(userId: string) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    const sub = db.subscriptions.find((s) => s.userId === userId && s.status === "active");
    if (!sub) throw new CloudColsError("NO_SUBSCRIPTION", 404, "No active subscription.");
    sub.status = "cancelled";
    sub.cancelledAt = new Date().toISOString();
    saveDb();
    return sub;
  }
}

// ---------------------------------------------------------------------------
// Developer
// ---------------------------------------------------------------------------
class MockDeveloperRepository implements DeveloperRepository {
  async apiPlans() {
    await delay();
    return getDb().apiPlans;
  }
  async keys(userId: string) {
    await delay();
    requireUser(getDb(), userId);
    return getDb().apiKeys.filter((k) => k.userId === userId);
  }
  async createKey(userId: string, label: string, scopes: string[]) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    const prefix = `cc_live_${Math.random().toString(16).slice(2, 6)}`;
    const secret = `sk_${uuid().replace(/-/g, "")}`;
    const key = {
      id: `key_${uuid()}`,
      userId,
      apiPlanId: "api_pro",
      keyPrefix: prefix,
      hashedKey: secret.slice(0, 12),
      label: label.trim() || "Untitled key",
      scopes,
      status: "active" as const,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    db.apiKeys.push(key);
    saveDb();
    return { key, secret: `${prefix}_${secret}` };
  }
  async revokeKey(userId: string, keyId: string) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    const key = db.apiKeys.find((k) => k.id === keyId);
    if (key && key.userId === userId) {
      key.status = "revoked";
      saveDb();
    }
  }
  async usage(userId: string, days = 7) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    const keyIds = new Set(db.apiKeys.filter((k) => k.userId === userId).map((k) => k.id));
    const cutoff = Date.now() - days * 86400000;
    const logs = db.apiLogs.filter((l) => keyIds.has(l.apiKeyId) && new Date(l.createdAt).getTime() >= cutoff);
    logs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items: logs, total: logs.length, page: 1, pageSize: 100 };
  }
  async webhooks(userId: string) {
    await delay();
    requireUser(getDb(), userId);
    return getDb().webhooks.filter((w) => w.userId === userId);
  }
  async createWebhook(userId: string, url: string, events: string[]) {
    await delay();
    const db = getDb();
    requireUser(db, userId);
    if (!/^https:\/\//.test(url)) throw new CloudColsError("INVALID_URL", 400, "Webhook URL must be HTTPS.");
    const wh = {
      id: `hook_${uuid()}`,
      userId,
      url,
      events,
      status: "active" as const,
      secret: `whsec_${uuid().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      lastDeliveryStatus: "pending" as const,
      lastDeliveredAt: null,
    };
    db.webhooks.push(wh);
    saveDb();
    return wh;
  }
  async updateWebhook(userId: string, id: string, patch: Partial<Webhook>) {
    await delay();
    const db = getDb();
    const wh = db.webhooks.find((w) => w.id === id);
    if (wh && wh.userId === userId) {
      Object.assign(wh, patch);
      saveDb();
    }
    return wh!;
  }
  async deleteWebhook(userId: string, id: string) {
    await delay();
    const db = getDb();
    const idx = db.webhooks.findIndex((w) => w.id === id);
    if (idx >= 0 && db.webhooks[idx].userId === userId) {
      db.webhooks.splice(idx, 1);
      saveDb();
    }
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
class MockNotificationRepository implements NotificationRepository {
  async list(userId: string) {
    await delay(200);
    const db = getDb();
    return db.notifications.filter((n) => n.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async unreadCount(userId: string) {
    const db = getDb();
    return db.notifications.filter((n) => n.userId === userId && !n.isRead).length;
  }
  async markRead(userId: string, id: string) {
    const db = getDb();
    const n = db.notifications.find((n) => n.id === id);
    if (n && n.userId === userId) {
      n.isRead = true;
      saveDb();
    }
  }
  async markAllRead(userId: string) {
    const db = getDb();
    db.notifications.forEach((n) => {
      if (n.userId === userId) n.isRead = true;
    });
    saveDb();
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
class MockAdminRepository implements AdminRepository {
  async stats() {
    await delay(400);
    const db = getDb();
    const totalFiles = db.files.filter((f) => !f.trashedAt).length;
    const storageUsedBytes = db.files.filter((f) => !f.trashedAt).reduce((a, f) => a + f.sizeBytes, 0);
    const activeSubscriptions = db.subscriptions.filter((s) => s.status === "active" && s.planId !== "plan_free").length;
    const mrrCents = db.subscriptions
      .filter((s) => s.status === "active")
      .reduce((a, s) => a + (db.plans.find((p) => p.id === s.planId)?.priceCents ?? 0), 0);
    return {
      totalUsers: db.users.length + 4800,
      activeUsers: 3200,
      newSignups7d: 46,
      totalFiles: totalFiles + 12400,
      storageUsedBytes,
      activeSubscriptions,
      mrrCents,
      apiRequests7d: db.apiLogs.length + 18400,
    };
  }
  async users() {
    await delay();
    return getDb().users;
  }
  async accounts() {
    await delay();
    return getDb().users;
  }
  async payments() {
    await delay();
    return getDb().payments;
  }
  async plans() {
    await delay();
    return getDb().plans;
  }
  async auditLogs() {
    await delay();
    return getDb().auditLogs;
  }
}

// ---------------------------------------------------------------------------
// Export singletons
// ---------------------------------------------------------------------------
export const filesRepo: FilesRepository = new MockFilesRepository();
export const authRepo: AuthRepository = new MockAuthRepository();
export const planRepo: PlanRepository = new MockPlanRepository();
export const shareRepo: ShareRepository = new MockShareRepository();
export const subscriptionRepo: SubscriptionRepository = new MockSubscriptionRepository();
export const developerRepo: DeveloperRepository = new MockDeveloperRepository();
export const notificationRepo: NotificationRepository = new MockNotificationRepository();
export const adminRepo: AdminRepository = new MockAdminRepository();

export type { FilesRepository };
