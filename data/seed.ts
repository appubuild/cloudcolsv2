import type {
  AdminUser,
  ApiPlan,
  ApiKey,
  ApiRequestLog,
  AuditLog,
  File,
  Folder,
  Notification,
  Payment,
  Plan,
  ShareLink,
  Subscription,
  User,
  Webhook,
  FileCategory,
} from "@/lib/types";
import { uuid } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Mock seed data.
// This module is the ONLY place sample data lives. UI never imports this
// directly — it flows through the repository layer (lib/repositories).
// ---------------------------------------------------------------------------

export const GB = 1024 * 1024 * 1024;
export const MB = 1024 * 1024;
export const KB = 1024;

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86400000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 3600000).toISOString();

// --- Categories metadata ------------------------------------------------
export const CATEGORY_LABELS: Record<FileCategory, string> = {
  image: "Images",
  video: "Videos",
  audio: "Audio",
  pdf: "PDF",
  document: "Documents",
  archive: "Archives",
  other: "Other",
};

export const CATEGORY_EXT: Record<
  FileCategory,
  { ext: string; mime: string; size: number }
> = {
  image: { ext: "jpg", mime: "image/jpeg", size: 4 * MB },
  video: { ext: "mp4", mime: "video/mp4", size: 240 * MB },
  audio: { ext: "mp3", mime: "audio/mpeg", size: 12 * MB },
  pdf: { ext: "pdf", mime: "application/pdf", size: 6 * MB },
  document: { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 2 * MB },
  archive: { ext: "zip", mime: "application/zip", size: 90 * MB },
  other: { ext: "bin", mime: "application/octet-stream", size: 1 * MB },
};

// --- Object key convention ----------------------------------------------
// {userId}/user-files/{category}/{yyyy}/{mm}/CC-{uuidV4}.{ext}
function objectKey(userId: string, category: FileCategory, i: number): string {
  const ext = CATEGORY_EXT[category].ext;
  const y = 2026;
  const m = String((i % 12) + 1).padStart(2, "0");
  return `${userId}/user-files/${category}/${y}/${m}/CC-${uuid()}.${ext}`;
}

const buildIconSvg = (label: string, fg: string, bg: string): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/><text x="32" y="42" font-family="system-ui,sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="${fg}">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

// --- Users ----------------------------------------------------------------
export const seedUsers: User[] = [
  {
    id: "user_free",
    email: "alex@example.com",
    name: "Alex Rivera",
    username: "alexrivera",
    avatarUrl: null,
    planId: "plan_free",
    storageUsedBytes: 0,
    storageQuotaBytes: 5 * GB,
    role: "user",
    developerEnabled: false,
    status: "active",
    createdAt: daysAgo(120),
    lastLoginAt: hoursAgo(3),
  },
  {
    id: "user_pro",
    email: "maya@example.com",
    name: "Maya Chen",
    username: "mayachen",
    avatarUrl: null,
    planId: "plan_plus",
    storageUsedBytes: 0,
    storageQuotaBytes: 100 * GB,
    role: "user",
    developerEnabled: true,
    status: "active",
    createdAt: daysAgo(200),
    lastLoginAt: hoursAgo(26),
  },
  {
    id: "user_business",
    email: "sam@example.com",
    name: "Sam Odeke",
    username: "samodeke",
    avatarUrl: null,
    planId: "plan_business",
    storageUsedBytes: 0,
    storageQuotaBytes: 1 * 1024 * GB,
    role: "user",
    developerEnabled: true,
    status: "active",
    createdAt: daysAgo(300),
    lastLoginAt: daysAgo(4),
  },
];

// --- Folders (owner = user_pro, maya) -------------------------------------
export const seedFolders: Folder[] = [
  {
    id: "folder_work",
    ownerId: "user_pro",
    parentId: null,
    name: "Work",
    path: "Work",
    createdAt: daysAgo(180),
    updatedAt: daysAgo(2),
    trashedAt: null,
    isFavorite: true,
    isPinned: false,
    icon: null,
    lastAccessedAt: hoursAgo(6),
  },
  {
    id: "folder_projects",
    ownerId: "user_pro",
    parentId: "folder_work",
    name: "Projects",
    path: "Work / Projects",
    createdAt: daysAgo(170),
    updatedAt: daysAgo(1),
    trashedAt: null,
    isFavorite: false,
    isPinned: false,
    icon: null,
    lastAccessedAt: hoursAgo(90),
  },
  {
    id: "folder_design",
    ownerId: "user_pro",
    parentId: "folder_work",
    name: "Design Assets",
    path: "Work / Design Assets",
    createdAt: daysAgo(150),
    updatedAt: daysAgo(9),
    trashedAt: null,
    isFavorite: true,
    isPinned: false,
    icon: null,
    lastAccessedAt: hoursAgo(20),
  },
  {
    id: "folder_photos",
    ownerId: "user_pro",
    parentId: null,
    name: "Photos",
    path: "Photos",
    createdAt: daysAgo(120),
    updatedAt: daysAgo(6),
    trashedAt: null,
    isFavorite: true,
    isPinned: false,
    icon: null,
    lastAccessedAt: hoursAgo(3),
  },
  {
    id: "folder_media",
    ownerId: "user_free",
    parentId: null,
    name: "Media Box",
    path: "Media Box",
    createdAt: daysAgo(60),
    updatedAt: daysAgo(12),
    trashedAt: null,
    isFavorite: false,
    isPinned: false,
    icon: null,
    lastAccessedAt: hoursAgo(52),
  },
  {
    id: "folder_trashed",
    ownerId: "user_pro",
    parentId: "folder_work",
    name: "Old Stuff",
    path: "Work / Old Stuff",
    createdAt: daysAgo(80),
    updatedAt: daysAgo(20),
    trashedAt: daysAgo(15),
    isFavorite: false,
    isPinned: false,
    icon: null,
    lastAccessedAt: hoursAgo(720),
  },
];

// --- A small helper to build files for a given user ------------------------
function buildFiles(
  ownerId: string,
  spec: { name: string; cat: FileCategory; folderId: string | null; size?: number; fav?: boolean; trashed?: boolean; createdDays?: number; modifiedHours?: number; accessedHours?: number; status?: File["status"]; checksum?: string }[],
  indexOffset: number
): File[] {
  return spec.map((s, i) => {
    const catMeta = CATEGORY_EXT[s.cat];
    const ext = s.name.split(".").pop() || catMeta.ext;
    const size = s.size ?? catMeta.size;
    const id = `file_${ownerId}_${indexOffset + i}`;
    return {
      id,
      ownerId,
      folderId: s.folderId,
      objectKey: objectKey(ownerId, s.cat, indexOffset + i),
      originalFilename: s.name,
      mimeType: s.name.endsWith(".pdf")
        ? "application/pdf"
        : s.cat === "image"
          ? `image/${ext === "png" ? "png" : "jpeg"}`
          : s.cat === "video"
            ? "video/mp4"
            : s.cat === "audio"
              ? "audio/mpeg"
              : catMeta.mime,
      category: s.cat,
      sizeBytes: s.cat === "image" ? size : size,
      thumbnailUrl: s.cat === "image" ? buildIconSvg(ext.toUpperCase().slice(0, 3), "#ffffff", "#2563eb") : null,
      checksum: s.checksum ?? null,
      status: s.status ?? "ready",
      isFavorite: s.fav ?? false,
      createdAt: daysAgo(s.createdDays ?? 30),
      updatedAt: hoursAgo(s.modifiedHours ?? 40),
      trashedAt: s.trashed ? daysAgo(s.trashed ? 10 : 0) : null,
      lastAccessedAt: s.accessedHours != null ? hoursAgo(s.accessedHours) : hoursAgo(24),
    };
  });
}

const FREE_FILES = [
  { name: "Vacation Photo.jpg", cat: "image", folderId: null, size: 6 * MB, fav: true, createdDays: 15, modifiedHours: 30, accessedHours: 5 },
  { name: "Receipt 2026.pdf", cat: "pdf", folderId: null, createdDays: 40, modifiedHours: 500 },
  { name: "Build Notes.docx", cat: "document", folderId: "folder_media", createdDays: 20, modifiedHours: 90 },
  { name: "Podcast Episode 3.mp3", cat: "audio", folderId: "folder_media", size: 60 * MB, createdDays: 25, modifiedHours: 110 },
  { name: "Screenshot.png", cat: "image", folderId: null, size: 1 * MB, accessedHours: 2 },
  { name: "Old Backup.zip", cat: "archive", folderId: null, size: 200 * MB, trashed: true },
] as const;

const PRO_FILES = [
  { name: "Brand Guidelines.pdf", cat: "pdf", folderId: "folder_work", createdDays: 60, modifiedHours: 20, accessedHours: 3 },
  { name: "Hero Banner.png", cat: "image", folderId: "folder_design", size: 8 * MB, fav: true, createdDays: 30, modifiedHours: 12, accessedHours: 1 },
  { name: "Product Walkthrough.mp4", cat: "video", folderId: "folder_work", size: 700 * MB, createdDays: 45, modifiedHours: 70, accessedHours: 4 },
  { name: "Q3 Report.docx", cat: "document", folderId: "folder_projects", createdDays: 18, modifiedHours: 6 },
  { name: "Logo.svg", cat: "other", folderId: "folder_design", size: 20 * KB, fav: true, createdDays: 33 },
  { name: "Team Offsite.mp4", cat: "video", folderId: "folder_photos", size: 1.2 * GB, createdDays: 12, modifiedHours: 200 },
  { name: "Pitch Deck.pptx", cat: "document", folderId: "folder_projects", size: 14 * MB, createdDays: 22, modifiedHours: 48 },
  { name: "Launch Audio.mp3", cat: "audio", folderId: "folder_media", size: 30 * MB, createdDays: 10, modifiedHours: 15 },
  { name: "Contract Bundle.zip", cat: "archive", folderId: "folder_work", size: 120 * MB, createdDays: 50, modifiedHours: 300 },
  { name: "Research Data.csv", cat: "other", folderId: "folder_projects", size: 4 * MB, createdDays: 16 },
  { name: "Screen Recording.mov", cat: "video", folderId: "folder_design", size: 300 * MB, trashed: true },
  { name: "Invoice July.pdf", cat: "pdf", folderId: "folder_work", size: 200 * KB, fav: true, createdDays: 35, accessedHours: 9 },
] as const;

export const seedFiles: File[] = [
  ...buildFiles("user_free", [...FREE_FILES] as never[], 0),
  ...buildFiles("user_pro", [...PRO_FILES] as never[], 100),
];

// --- Plans ----------------------------------------------------------------
export const seedPlans: Plan[] = [
  {
    id: "plan_free",
    name: "Free",
    tagline: "For getting started",
    storageQuotaBytes: 5 * GB,
    priceCents: 0,
    billingInterval: null,
    features: ["5 GB storage", "Basic file manager", "Ads shown", "Sharing links"],
    showsAds: true,
    apiIncluded: false,
    maxFileSizeBytes: 1 * GB,
    isActive: true,
    sortOrder: 0,
  },
  {
    id: "plan_plus",
    name: "Plus",
    tagline: "For everyday use",
    storageQuotaBytes: 100 * GB,
    priceCents: 499,
    billingInterval: "monthly",
    features: ["100 GB storage", "No ads", "2 GB max file size", "Advanced sharing"],
    showsAds: false,
    apiIncluded: false,
    maxFileSizeBytes: 2 * GB,
    isActive: true,
    sortOrder: 1,
  },
  {
    id: "plan_pro",
    name: "Pro",
    tagline: "For creators & pros",
    storageQuotaBytes: 200 * GB,
    priceCents: 899,
    billingInterval: "monthly",
    features: ["200 GB storage", "No ads", "3 GB max file size", "Priority support"],
    showsAds: false,
    apiIncluded: true,
    maxFileSizeBytes: 3 * GB,
    isActive: true,
    sortOrder: 2,
  },
  {
    id: "plan_business",
    name: "Business",
    tagline: "For teams & power users",
    storageQuotaBytes: 1 * 1024 * GB,
    priceCents: 1999,
    billingInterval: "monthly",
    features: ["1 TB storage", "No ads", "5 GB max file size", "API access"],
    showsAds: false,
    apiIncluded: true,
    maxFileSizeBytes: 5 * GB,
    isActive: true,
    sortOrder: 3,
  },
];

export const seedSubscriptions: Subscription[] = [
  { id: "sub_pro", userId: "user_pro", planId: "plan_plus", status: "active", provider: "card", startedAt: daysAgo(120), renewsAt: daysAgo(-9), cancelledAt: null },
  { id: "sub_business", userId: "user_business", planId: "plan_business", status: "active", provider: "card", startedAt: daysAgo(200), renewsAt: daysAgo(-20), cancelledAt: null },
  { id: "sub_free", userId: "user_free", planId: "plan_free", status: "active", provider: null, startedAt: daysAgo(120), renewsAt: null, cancelledAt: null },
];

export const seedPayments: Payment[] = [
  { id: "pay_1", userId: "user_pro", subscriptionId: "sub_pro", amountCents: 499, currency: "USD", provider: "card", status: "succeeded", createdAt: daysAgo(9) },
  { id: "pay_2", userId: "user_pro", subscriptionId: "sub_pro", amountCents: 499, currency: "USD", provider: "card", status: "succeeded", createdAt: daysAgo(39) },
  { id: "pay_3", userId: "user_business", subscriptionId: "sub_business", amountCents: 1999, currency: "USD", provider: "card", status: "succeeded", createdAt: daysAgo(20) },
  { id: "pay_4", userId: "user_business", subscriptionId: "sub_business", amountCents: 1999, currency: "USD", provider: "card", status: "succeeded", createdAt: daysAgo(50) },
  { id: "pay_5", userId: "user_pro", subscriptionId: "sub_pro", amountCents: 499, currency: "USD", provider: "card", status: "failed", createdAt: daysAgo(3) },
  { id: "pay_6", userId: "user_business", subscriptionId: "sub_business", amountCents: 1999, currency: "USD", provider: "card", status: "pending", createdAt: daysAgo(1) },
];

// --- Sharing --------------------------------------------------------------
export const seedShares: ShareLink[] = [
  { id: "share_1", ownerId: "user_pro", fileId: "file_user_pro_100", folderId: null, token: "aJ9xKq2pLm", permission: "download", expiresAt: null, isRevoked: false, createdAt: daysAgo(6), accessCount: 14 },
  { id: "share_2", ownerId: "user_pro", fileId: "file_user_pro_105", folderId: null, token: "Rt4vNw7zQm", permission: "view", expiresAt: daysAgo(-2), isRevoked: false, createdAt: daysAgo(2), accessCount: 3 },
  { id: "share_3", ownerId: "user_pro", fileId: "file_user_pro_104", folderId: null, token: "Fk2xPq9aTz", permission: "download", expiresAt: daysAgo(30), isRevoked: true, createdAt: daysAgo(20), accessCount: 41 },
  { id: "share_4", ownerId: "user_free", folderId: "folder_media", fileId: null, token: "Zq8vRb3nYw", permission: "view", expiresAt: null, isRevoked: false, createdAt: daysAgo(4), accessCount: 7 },
];

// --- Developer API --------------------------------------------------------
export const seedApiPlans: ApiPlan[] = [
  { id: "api_free", name: "Developer Free", requestsPerMonth: 10000, rateLimitPerMinute: 60, priceCents: 0, isActive: true },
  { id: "api_pro", name: "Developer", requestsPerMonth: 200000, rateLimitPerMinute: 300, priceCents: 2900, isActive: true },
  { id: "api_business", name: "Business", requestsPerMonth: 2000000, rateLimitPerMinute: 1500, priceCents: 9900, isActive: true },
  { id: "api_enterprise", name: "Enterprise", requestsPerMonth: 20000000, rateLimitPerMinute: 5000, priceCents: 0, isActive: false },
];

export const seedApiKeys: ApiKey[] = [
  { id: "key_1", userId: "user_pro", apiPlanId: "api_pro", keyPrefix: "cc_live_8f2a", hashedKey: "a1b2c3de", label: "Production", scopes: ["files.read", "files.write", "files.delete", "share.create"], status: "active", createdAt: daysAgo(30), lastUsedAt: hoursAgo(2) },
  { id: "key_2", userId: "user_pro", apiPlanId: "api_pro", keyPrefix: "cc_live_1c9d", hashedKey: "f9e8d7c6", label: "Staging", scopes: ["files.read", "files.write"], status: "active", createdAt: daysAgo(14), lastUsedAt: daysAgo(3) },
  { id: "key_3", userId: "user_business", apiPlanId: "api_business", keyPrefix: "cc_live_7ab2", hashedKey: "00aa11bb", label: "CI runner", scopes: ["files.read"], status: "revoked", createdAt: daysAgo(40), lastUsedAt: daysAgo(10) },
];

const endpoints = ["GET /v1/files", "GET /v1/files/:id", "POST /v1/files/upload", "GET /v1/folders", "POST /v1/files/:id/share", "GET /v1/search"];
const codes = [200, 200, 201, 200, 200, 401, 200, 429, 200, 500];
const logMethods = ["GET", "GET", "POST", "GET", "POST", "GET", "GET", "POST", "GET", "GET"];

export const seedApiLogs: ApiRequestLog[] = Array.from({ length: 24 }).map((_, i) => {
  const e = endpoints[i % endpoints.length];
  const method = logMethods[i % logMethods.length];
  const statusCode = codes[i % codes.length];
  return {
    id: `alog_${i}`,
    apiKeyId: i % 2 === 0 ? "key_1" : "key_2",
    endpoint: e,
    method,
    statusCode,
    responseTimeMs: 20 + Math.floor(Math.random() * 220),
    createdAt: hoursAgo(i * 2),
  };
});

export const seedWebhooks: Webhook[] = [
  { id: "hook_1", userId: "user_pro", url: "https://example.com/hooks/cloudcols", events: ["file.created", "file.deleted", "file.shared"], status: "active", secret: "whsec_4e2a", createdAt: daysAgo(25), lastDeliveryStatus: "ok", lastDeliveredAt: hoursAgo(7) },
  { id: "hook_2", userId: "user_pro", url: "https://worker.example.dev/events", events: ["folder.created", "file.moved"], status: "disabled", secret: "whsec_91bc", createdAt: daysAgo(50), lastDeliveryStatus: "failed", lastDeliveredAt: daysAgo(6) },
];

// --- Notifications --------------------------------------------------------
export const seedNotifications: Notification[] = [
  { id: "n1", userId: "user_pro", type: "storage", title: "Storage almost full", body: "You've used 92% of your Plus storage. Upgrade to Pro for 200 GB.", isRead: false, createdAt: daysAgo(1), link: "/app/storage" },
  { id: "n2", userId: "user_pro", type: "payment", title: "Payment failed", body: "We couldn't charge your card for the Plus plan. Update your payment method.", isRead: false, createdAt: daysAgo(3), link: "/app/settings?tab=billing" },
  { id: "n3", userId: "user_pro", type: "security", title: "New sign-in", body: "Sign-in from a new device in Dhaka, Bangladesh.", isRead: true, createdAt: daysAgo(6), link: "/app/settings?tab=security" },
  { id: "n4", userId: "user_pro", type: "share", title: "File shared with you", body: "Sam shared 'Brand Guidelines.pdf' with you.", isRead: false, createdAt: daysAgo(2), link: "/app/shared" },
];

// --- Audit log ------------------------------------------------------------
export const seedAuditLogs: AuditLog[] = [
  { id: "a1", actorId: "admin_1", actorType: "admin", action: "user.suspend", targetType: "user", targetId: "usr_987", metadata: { reason: "Abuse report #2214" }, createdAt: daysAgo(2) },
  { id: "a2", actorId: "user_pro", actorType: "user", action: "api_key.create", targetType: "api_key", targetId: "key_2", metadata: { label: "Staging" }, createdAt: daysAgo(14) },
  { id: "a3", actorId: "user_pro", actorType: "user", action: "file.share", targetType: "file", targetId: "file_user_pro_101", metadata: { permission: "download" }, createdAt: daysAgo(6) },
  { id: "a4", actorId: "admin_1", actorType: "admin", action: "plan.update", targetType: "plan", targetId: "plan_pro", metadata: { priceCents: 899 }, createdAt: daysAgo(9) },
  { id: "a5", actorId: "system", actorType: "system", action: "user.warn_inactive", targetType: "user", targetId: "usr_123", metadata: { days: 30 }, createdAt: daysAgo(1) },
  { id: "a6", actorId: "user_business", actorType: "user", action: "subscription.upgrade", targetType: "subscription", targetId: "sub_business", metadata: { planId: "plan_business" }, createdAt: daysAgo(200) },
  { id: "a7", actorId: "admin_2", actorType: "admin", action: "content.update", targetType: "faq", targetId: "faq_1", metadata: { question: "How do I upgrade?" }, createdAt: daysAgo(3) },
];

// --- Admin users ----------------------------------------------------------
export const seedAdminUsers: AdminUser[] = [
  { id: "admin_1", email: "super@cloudcols.com", name: "Dana Liu", role: "super_admin", createdAt: daysAgo(300) },
  { id: "admin_2", email: "support@cloudcols.com", name: "Omar Faruk", role: "support", createdAt: daysAgo(200) },
  { id: "admin_3", email: "billing@cloudcols.com", name: "Priya Shah", role: "billing", createdAt: daysAgo(180) },
  { id: "admin_4", email: "content@cloudcols.com", name: "Jonas Weber", role: "content", createdAt: daysAgo(150) },
  { id: "admin_5", email: "audit@cloudcols.com", name: "Nadia Hossain", role: "auditor", createdAt: daysAgo(120) },
];

// --- System / health snapshot --------------------------------------------
export function computeStorageSnapshot(): {
  totalUsers: number;
  activeUsers: number;
  newSignups7d: number;
  totalFiles: number;
  storageUsedBytes: number;
  activeSubscriptions: number;
  mrrCents: number;
  apiRequests7d: number;
} {
  const totalFiles = seedFiles.filter((f) => !f.trashedAt).length;
  const storageUsedBytes = seedFiles.filter((f) => !f.trashedAt).reduce((a, f) => a + f.sizeBytes, 0);
  const activeSubscriptions = seedSubscriptions.filter((s) => s.status === "active" && s.planId !== "plan_free").length;
  const mrrCents = seedSubscriptions
    .filter((s) => s.status === "active")
    .reduce((a, s) => a + (seedPlans.find((p) => p.id === s.planId)?.priceCents ?? 0), 0);
  return {
    totalUsers: seedUsers.length + 4800, // scale to look like a real product
    activeUsers: 3200,
    newSignups7d: 46,
    totalFiles: totalFiles + 12400,
    storageUsedBytes,
    activeSubscriptions,
    mrrCents,
    apiRequests7d: seedApiLogs.length + 18400,
  };
}

export const seedStorageSnapshot = computeStorageSnapshot();
export const seedB2Objects = seedFiles.map((f) => f.objectKey);
