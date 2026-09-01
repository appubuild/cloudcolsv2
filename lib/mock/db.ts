// A tiny in-memory + localStorage-backed data store for the mock repositories.
// It is intentionally NOT a database — it exists so the UI has realistic,
// mutable data with latency and the occasional simulated failure. Swapping
// to a real API is achieved by changing the repository implementation.

import {
  seedAdminUsers,
  seedApiKeys,
  seedApiLogs,
  seedApiPlans,
  seedAuditLogs,
  seedFiles,
  seedFolders,
  seedNotifications,
  seedPayments,
  seedPlans,
  seedShares,
  seedSubscriptions,
  seedUsers,
  seedWebhooks,
} from "@/data/seed";
import type {
  AdminUser,
  ApiKey,
  ApiRequestLog,
  ApiPlan,
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
} from "@/lib/types";

const STORAGE_KEY = "cloudcols.mockdb.v1";

export interface MockDb {
  users: User[];
  folders: Folder[];
  files: File[];
  plans: Plan[];
  subscriptions: Subscription[];
  payments: Payment[];
  shares: ShareLink[];
  apiPlans: ApiPlan[];
  apiKeys: ApiKey[];
  apiLogs: ApiRequestLog[];
  webhooks: Webhook[];
  notifications: Notification[];
  auditLogs: AuditLog[];
  adminUsers: AdminUser[];
}

function freshDb(): MockDb {
  return {
    users: structuredClone(seedUsers),
    folders: structuredClone(seedFolders),
    files: structuredClone(seedFiles),
    plans: structuredClone(seedPlans),
    subscriptions: structuredClone(seedSubscriptions),
    payments: structuredClone(seedPayments),
    shares: structuredClone(seedShares),
    apiPlans: structuredClone(seedApiPlans),
    apiKeys: structuredClone(seedApiKeys),
    apiLogs: structuredClone(seedApiLogs),
    webhooks: structuredClone(seedWebhooks),
    notifications: structuredClone(seedNotifications),
    auditLogs: structuredClone(seedAuditLogs),
    adminUsers: structuredClone(seedAdminUsers),
  };
}

let memoryDb: MockDb | null = null;

/** Get the current DB instance (rehydrates from localStorage or rebuilds seed). */
export function getDb(): MockDb {
  if (memoryDb) return memoryDb;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        memoryDb = JSON.parse(raw) as MockDb;
        return memoryDb;
      }
    } catch {
      /* fall through to seed */
    }
  }
  memoryDb = freshDb();
  return memoryDb;
}

/** Persist the current DB to localStorage (client only). */
export function saveDb(): void {
  if (typeof window === "undefined" || !memoryDb) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryDb));
  } catch {
    /* ignore quota errors (size is small) */
  }
}

/** Reset all mock data back to the initial seed. */
export function resetDb(): void {
  memoryDb = freshDb();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
