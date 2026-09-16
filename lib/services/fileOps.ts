// The file operations, in one place, for both callers.
//
// The web app and the Developer API do the same things to the same files, and the
// rules that matter are not in the routes that expose them: a quota checked before an
// upload and re-checked against what storage actually received, a MIME allow-list,
// "the caller must own this", a webhook on every change. Two copies of those would be
// two chances for one to fall behind — and the one that falls behind is the one that
// lets something through.
//
// So the routes are thin: they decide who is calling (a session, or an API key with a
// scope) and then call these. Authorization by ownership is enforced here, on every
// operation, whichever route asked.

import "server-only";
import { ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getQuota, assertCanUpload } from "@/lib/api/quota";
import { buildObjectKey, deriveCategory } from "@/lib/storage/categories";
import { validateMime } from "@/lib/services/mime";
import { mapFile } from "@/lib/api/mappers";
import { recordActivity } from "@/lib/api/activity";
import { runAfterResponse } from "@/lib/api/background";
import { deliver } from "@/lib/jobs/webhookDelivery";
import { deleteObject, headObject } from "@/lib/services/b2";
import {
  getPresignedUploadUrl,
  createMultipartUpload,
  MULTIPART_PART_SIZE,
  MULTIPART_THRESHOLD,
  partSizeFor,
} from "@/lib/services/b2";
import type { File as CloudFile } from "@/lib/types";

export interface UploadTicketInput {
  filename: string;
  sizeBytes: number;
  mimeType?: string;
  folderId?: string | null;
}

export interface UploadTicket {
  uploadId: string;
  fileId: string;
  objectKey: string;
  presignedUrl: string;
  partSizeBytes: number;
  expiresIn: number;
  multipart: boolean;
  partCount: number;
  multipartUploadId: string | null;
}

/** The file, if this account owns it. Absent and not-yours answer the same way. */
export async function requireOwnedFile(ownerId: string, fileId: string): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const { data } = await admin.from("files").select("*").eq("id", fileId).eq("owner_id", ownerId).maybeSingle();
  if (!data) throw new ApiError("FILE_NOT_FOUND", 404, "File not found.");
  return data as Record<string, unknown>;
}

/**
 * Somewhere to send the bytes.
 *
 * Grants nothing on its own: the row is written as `pending` and only becomes a real
 * file when confirmUpload sees the object in storage at the size that was declared.
 */
export async function createUploadTicket(ownerId: string, input: UploadTicketInput): Promise<UploadTicket> {
  if (!input.filename?.trim()) throw new ApiError("INVALID_INPUT", 400, "Filename is required.");
  if (!Number.isFinite(input.sizeBytes)) throw new ApiError("INVALID_INPUT", 400, "sizeBytes must be a number.");

  const quota = await getQuota(ownerId);
  assertCanUpload(quota, input.sizeBytes);

  // The destination folder must belong to the caller. Checked rather than trusted, and
  // answered as NOT_FOUND rather than FORBIDDEN: confirming that an id exists would
  // let someone probe for other people's folders.
  const admin = createAdminClient();
  let folderId: string | null = null;
  if (input.folderId) {
    const { data: folder } = await admin
      .from("folders")
      .select("id")
      .eq("id", input.folderId)
      .eq("owner_id", ownerId)
      .is("trashed_at", null)
      .maybeSingle();
    if (!folder) throw new ApiError("FOLDER_NOT_FOUND", 404, "That folder does not exist.");
    folderId = String(folder.id);
  }

  const category = deriveCategory(input.mimeType ?? "", input.filename);
  const objectKey = buildObjectKey(ownerId, category, input.filename);
  const contentType = input.mimeType ?? "application/octet-stream";

  /**
   * Small files get one presigned PUT. Large ones get a multipart upload.
   *
   * The threshold exists because multipart costs a create, a complete, and a presign
   * per part — worth it for a file big enough that losing the connection matters, and
   * pure overhead for one that finishes in a single round trip.
   */
  const multipart = input.sizeBytes > MULTIPART_THRESHOLD;
  let presignedUrl = "";
  let multipartUploadId: string | null = null;
  let partSize = MULTIPART_PART_SIZE;

  if (multipart) {
    partSize = partSizeFor(input.sizeBytes);
    const created = await createMultipartUpload(objectKey, contentType);
    multipartUploadId = created.uploadId;
  } else {
    const presign = await getPresignedUploadUrl({ objectKey, contentType });
    presignedUrl = presign.presignedUrl;
  }

  const { data, error } = await admin
    .from("files")
    .insert({
      owner_id: ownerId,
      folder_id: folderId,
      object_key: objectKey,
      original_filename: input.filename.trim(),
      mime_type: contentType,
      category,
      size_bytes: input.sizeBytes,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw new ApiError("UPLOAD_FAILED", 500, error.message);

  return {
    uploadId: String(data.id),
    fileId: String(data.id),
    objectKey,
    presignedUrl,
    partSizeBytes: partSize,
    expiresIn: 3600,
    multipart,
    partCount: multipart ? Math.ceil(input.sizeBytes / partSize) : 1,
    /**
     * The storage upload id, held by the client and passed back when asking for part
     * URLs and when completing. Not persisted: it is not a capability on its own.
     */
    multipartUploadId,
  };
}

/**
 * Turns a pending row into a file, once storage confirms what it holds.
 *
 * Two checks that cannot move to the ticket: the size, because the quota check there
 * was against a number the client chose — accepting whatever arrived would make it
 * meaningless — and the type, which is decided from the server's own record rather
 * than anything the uploader said.
 */
export async function confirmUpload(ownerId: string, fileId: string): Promise<CloudFile> {
  const admin = createAdminClient();
  const file = await requireOwnedFile(ownerId, fileId);

  const head = await headObject(String(file.object_key));
  if (!head) throw new ApiError("UPLOAD_FAILED", 500, "Uploaded object was not found in storage.");

  const declared = Number(file.size_bytes);
  if (head.sizeBytes !== declared) {
    await deleteObject(String(file.object_key));
    await admin.from("files").delete().eq("id", fileId).eq("owner_id", ownerId);
    throw new ApiError("UPLOAD_FAILED", 422, "The uploaded file did not match the size that was declared.");
  }

  const { data: updated, error } = await admin
    .from("files")
    .update({ status: "ready", size_bytes: head.sizeBytes })
    .eq("id", fileId)
    .eq("owner_id", ownerId)
    .select("*")
    .single();
  if (error) throw new ApiError("UPLOAD_FAILED", 500, error.message);

  // Against the allow-list, using the server-recorded name and type. Blocks
  // executables and disguised or unsupported types.
  const v = validateMime(String(updated.original_filename), updated.mime_type ? String(updated.mime_type) : null);
  if (!v.allowed) {
    await deleteObject(String(file.object_key)).catch(() => {});
    await admin.from("files").delete().eq("id", fileId).eq("owner_id", ownerId);
    throw new ApiError("UNSUPPORTED_MEDIA", 415, v.reason ?? "Unsupported file type.");
  }

  const category = deriveCategory(v.effectiveMime, String(updated.original_filename));
  const { data: final } = await admin.from("files").update({ category }).eq("id", fileId).select("*").single();

  // Note: the files_quota_trigger in Postgres re-syncs storage_used_bytes.
  const row = (final ?? updated) as Record<string, unknown>;
  await recordActivity(ownerId, { fileId }, "uploaded");
  runAfterResponse(
    deliver(
      {
        id: String(row.id),
        type: "file.created",
        fileId: String(row.id),
        objectKey: String(row.object_key),
        ownerId,
        timestamp: new Date().toISOString(),
      },
      ownerId,
    ),
    "webhook file.created",
  );
  return mapFile(row);
}

/** Moves a file to the trash, or removes it and its thumbnail for good. */
export async function deleteFile(ownerId: string, fileId: string, permanent = false): Promise<void> {
  const admin = createAdminClient();
  const file = await requireOwnedFile(ownerId, fileId);

  if (permanent) {
    await deleteObject(String(file.object_key));
    // The thumbnail is a separate object and would otherwise be billed forever with
    // nothing pointing at it.
    if (file.thumbnail_url) await deleteObject(String(file.thumbnail_url)).catch(() => {});
    await admin.from("files").delete().eq("id", fileId).eq("owner_id", ownerId);
  } else {
    await admin.from("files").update({ trashed_at: new Date().toISOString() }).eq("id", fileId).eq("owner_id", ownerId);
  }

  runAfterResponse(
    deliver(
      {
        id: String(file.id),
        type: permanent ? "file.deleted" : "file.trashed",
        fileId: String(file.id),
        objectKey: String(file.object_key),
        ownerId,
        timestamp: new Date().toISOString(),
      },
      ownerId,
    ),
    `webhook file.${permanent ? "deleted" : "trashed"}`,
  );
}

export interface ShareLinkInput {
  fileId?: string | null;
  folderId?: string | null;
  permission?: "view" | "download";
  expiresAt?: string | null;
}

/**
 * A share link for something the caller owns.
 *
 * The ownership check is the point. This writes with the service-role client, which
 * RLS does not constrain: without it, anyone who learned another account's file id
 * could mint a link to it under their own name, and /api/shares/download would honour
 * it — the token is that route's only authority.
 */
export async function createShareLink(ownerId: string, input: ShareLinkInput): Promise<Record<string, unknown>> {
  const fileId = input.fileId ?? null;
  const folderId = input.folderId ?? null;
  if (Number(Boolean(fileId)) + Number(Boolean(folderId)) !== 1) {
    throw new ApiError("INVALID_INPUT", 400, "Share exactly one file or one folder.");
  }

  const admin = createAdminClient();
  const { data: owned } = await admin
    .from(fileId ? "files" : "folders")
    .select("id")
    .eq("id", (fileId ?? folderId)!)
    .eq("owner_id", ownerId)
    .is("trashed_at", null)
    .maybeSingle();
  if (!owned) {
    throw new ApiError(fileId ? "FILE_NOT_FOUND" : "FOLDER_NOT_FOUND", 404, fileId ? "File not found." : "Folder not found.");
  }

  const permission = input.permission === "download" ? "download" : "view";
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const { data, error } = await admin
    .from("share_links")
    .insert({
      owner_id: ownerId,
      file_id: fileId,
      folder_id: folderId,
      token,
      permission,
      expires_at: input.expiresAt ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Record<string, unknown>;
}
