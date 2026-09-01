// Row → domain mappers for the Postgres tables.

import type { File, Folder, User } from "@/lib/types";

export function mapFile(row: Record<string, unknown>): File {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    folderId: row.folder_id ? String(row.folder_id) : null,
    objectKey: String(row.object_key),
    originalFilename: String(row.original_filename),
    mimeType: String(row.mime_type),
    category: row.category as File["category"],
    sizeBytes: Number(row.size_bytes),
    thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : null,
    checksum: row.checksum ? String(row.checksum) : null,
    status: (row.status as File["status"]) ?? "pending",
    isFavorite: Boolean(row.is_favorite),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    trashedAt: row.trashed_at ? String(row.trashed_at) : null,
    lastAccessedAt: row.last_accessed_at ? String(row.last_accessed_at) : null,
  };
}

export function mapFolder(row: Record<string, unknown>): Folder {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    name: String(row.name),
    path: String(row.path ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    trashedAt: row.trashed_at ? String(row.trashed_at) : null,
    isFavorite: Boolean(row.is_favorite),
    lastAccessedAt: row.last_accessed_at ? String(row.last_accessed_at) : null,
  };
}

export function mapUserProfile(row: Record<string, unknown>, authUser: { id: string; email: string }): User {
  return {
    id: authUser.id,
    email: authUser.email,
    name: authUser.email.split("@")[0] ?? "User",
    username: (authUser.email.split("@")[0] ?? "user").replace(/[^a-z0-9]/gi, ""),
    avatarUrl: null,
    planId: String(row.plan_id ?? "plan_free"),
    storageUsedBytes: Number(row.storage_used_bytes ?? 0),
    storageQuotaBytes: Number(row.storage_quota_bytes ?? 5 * 1024 * 1024 * 1024),
    role: "user",
    developerEnabled: Boolean(row.developer_enabled),
    status: (row.status as User["status"]) ?? "active",
    createdAt: String(row.created_at ?? new Date().toISOString()),
    lastLoginAt: String(row.last_login_at ?? new Date().toISOString()),
  };
}
