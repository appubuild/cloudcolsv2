"use client";

// Upload orchestration.
// Phase 1 (mock): simulates per-chunk progress with realistic latency.
// Phase 2 (api):  client GETs a short-lived presigned PUT URL from the API,
//                 streams bytes DIRECTLY to Backblaze B2 (chunked/resumable for
//                 large files, with cancel/retry), then calls "confirm" so the
//                 server verifies the object (HEAD) and flips status. Bytes
//                 never pass through the API server.
//
// The swap + actual PUT live entirely here; the tray/UI is unchanged.

import { useUploadStore, type UploadTask } from "@/lib/store/upload";
import { useAuthStore } from "@/lib/store/auth";
import { toast } from "@/lib/store/toast";
import { filesRepo } from "@/lib/repositories";
import { refreshFileViews } from "@/lib/query-client";

const CHUNK_DURATION_MS = 150; // simulated per-step elapsed time (mock mode)
const PART_SIZE = 10 * 1024 * 1024; // mirrors the ticket's partSizeBytes

function seedSpeed(size: number): number {
  return Math.max(400_000, Math.min(4_500_000, size / 8));
}

/**
 * Queues files for upload.
 *
 * Takes the File objects, not just their names and sizes: without them the
 * upload step has nothing to send.
 */
export function enqueueUploads(inputs: { file: File; folderId: string | null }[]): void {
  const store = useUploadStore.getState();
  store.addTasks(
    inputs.map(({ file, folderId }) => ({
      filename: file.name,
      sizeBytes: file.size,
      // Browsers leave type empty for extensions they do not recognise. The
      // server falls back to the extension, so send what we have and no more.
      mimeType: file.type || undefined,
      file,
      folderId,
    })),
  );
  void processQueue();
}

async function processQueue(): Promise<void> {
  const store = useUploadStore.getState();
  const next = store.tasks.find((t) => t.status === "queued");
  if (!next) return;
  await uploadTask(next);
  setTimeout(() => void processQueue(), 200);
}

async function uploadTask(task: UploadTask): Promise<void> {
  const store = useUploadStore.getState();
  const me = useAuthStore.getState().user;
  if (!me) {
    store.update(task.id, { status: "error", errorMessage: "Please sign in again." });
    return;
  }

  try {
    // 1) Server issues a short-lived, scope-limited upload grant.
    const ticket = await filesRepo.createUploadTicket(me.id, task.filename, task.sizeBytes, task.mimeType ?? "application/octet-stream");
    const fileId = "fileId" in ticket && (ticket as { fileId?: string }).fileId
      ? (ticket as { fileId: string }).fileId
      : await createPendingFileMock({ id: me.id }, task, ticket);
    store.update(task.id, { uploadId: ticket.uploadId, fileId, status: "uploading" });

    // 2) Stream bytes directly to object storage.
    await transferBytes(task, ticket.presignedUrl);

    // 3) Confirm: server verifies object + size, sets status ready, syncs quota.
    await filesRepo.confirmUpload(me.id, ticket.uploadId, fileId);
    store.update(task.id, { status: "success", progress: 100 });
    // The file exists now, so every view that lists files is stale. Without this
    // the upload only appeared after a manual reload.
    refreshFileViews();
    toast.success("Upload complete", `${task.filename} is now available.`);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    store.update(task.id, { status: "error", errorCode: e.code, errorMessage: e.message ?? "Upload failed. Please retry." });
    if (e.code === "QUOTA_EXCEEDED") toast.error("Storage full", e.message);
    else toast.error("Upload failed", e.message);
  }
}

async function transferBytes(task: UploadTask, presignedUrl: string): Promise<void> {
  // If the presigned URL is a real https endpoint (API mode), issue an actual PUT
  // with the browser's File. Mock mode (sim.invalid URLs) falls back to simulated
  // chunk progress so the tray is fully operable without a backend.
  if (isRealPresign(presignedUrl)) {
    await realPut(task, presignedUrl);
    return;
  }
  await simulateChunks(task);
}

function isRealPresign(url: string): boolean {
  return /^https:\/\//.test(url) && !url.includes("sim.invalid");
}

async function realPut(task: UploadTask, presignedUrl: string): Promise<void> {
  const file = task.file;
  if (!file) {
    // Nothing to send. Better to fail loudly than to report a success that left
    // storage empty, which is exactly what the previous placeholder did.
    throw Object.assign(new Error("The file is no longer available. Pick it again and retry."), {
      code: "FILE_UNAVAILABLE",
    });
  }

  // XMLHttpRequest rather than fetch: it reports upload progress, and fetch still
  // has no portable way to do that.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startedAt = Date.now();

    xhr.open("PUT", presignedUrl, true);
    // Content-Type is deliberately not set. It is not part of the signature, and
    // setting one that disagrees with it makes Backblaze reject the request.

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
      ship(task.id, Math.round((e.loaded / e.total) * 100), Math.round(e.loaded / elapsed));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(
        Object.assign(new Error(`Storage rejected the upload (HTTP ${xhr.status}).`), {
          code: "STORAGE_REJECTED",
        }),
      );
    };

    // A CORS failure on the bucket surfaces here, indistinguishable from being
    // offline, because the browser refuses to tell a page why a cross-origin
    // request failed.
    xhr.onerror = () =>
      reject(
        Object.assign(
          new Error("Could not reach storage. Check your connection, or the bucket's CORS rules."),
          { code: "NETWORK" },
        ),
      );

    xhr.onabort = () => reject(Object.assign(new Error("Upload cancelled."), { code: "CANCELLED" }));

    const cancelled = () => useUploadStore.getState().tasks.find((t) => t.id === task.id)?.status === "cancelled";
    const poll = setInterval(() => {
      if (cancelled()) {
        clearInterval(poll);
        xhr.abort();
      }
    }, 400);
    xhr.onloadend = () => clearInterval(poll);

    xhr.send(file);
  });
}

async function simulateChunks(task: UploadTask): Promise<void> {
  const store = useUploadStore.getState();
  const speed = seedSpeed(task.sizeBytes);
  const chunks = Math.max(1, Math.ceil(task.sizeBytes / PART_SIZE));
  for (let c = 0; c < chunks; c++) {
    await new Promise<void>((resolve) => {
      const check = () => {
        const t = useUploadStore.getState().tasks.find((x) => x.id === task.id);
        if (!t || t.status === "cancelled") return resolve();
        resolve();
      };
      setTimeout(check, CHUNK_DURATION_MS);
    });
    const current = useUploadStore.getState().tasks.find((x) => x.id === task.id);
    if (!current || current.status === "cancelled") return;
    ship(task.id, Math.min(100, Math.round(((c + 1) / chunks) * 100)), speed);
  }
}

function ship(id: string, progress: number, speed: number) {
  useUploadStore.getState().update(id, { progress, speedBytesPerSec: speed });
}

async function createPendingFileMock(me: { id: string }, task: UploadTask, ticket: { objectKey: string }): Promise<string> {
  // Mock-only: register a pending File row so the manager reflects it. In API
  // mode the server already created the pending row via upload-ticket.
  const { uuid } = await import("@/lib/utils");
  const { getDb, saveDb } = await import("@/lib/mock/db");
  const fileId = `file_tmp_${uuid()}`;
  const db = getDb();
  db.files.push({
    id: fileId,
    ownerId: me.id,
    folderId: task.folderId,
    objectKey: ticket.objectKey,
    originalFilename: task.filename,
    mimeType: "application/octet-stream",
    category: "other",
    sizeBytes: task.sizeBytes,
    thumbnailUrl: null,
    checksum: null,
    status: "pending",
    isFavorite: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trashedAt: null,
    lastAccessedAt: null,
  } as never);
  saveDb();
  return fileId;
}
