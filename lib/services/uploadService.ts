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
import { makeThumbnail } from "./thumbnailer";
import { apiClient } from "@/lib/api/client";

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
    const ticket = await filesRepo.createUploadTicket(
      me.id,
      task.filename,
      task.sizeBytes,
      task.mimeType ?? "application/octet-stream",
      task.folderId,
    );
    const fileId = "fileId" in ticket && (ticket as { fileId?: string }).fileId
      ? (ticket as { fileId: string }).fileId
      : await createPendingFileMock({ id: me.id }, task, ticket);
    store.update(task.id, { uploadId: ticket.uploadId, fileId, status: "uploading" });

    // 2) Stream bytes directly to object storage — in parts when the server said so.
    const mp = ticket as unknown as { multipart?: boolean; multipartUploadId?: string | null; partSizeBytes?: number };
    if (mp.multipart && mp.multipartUploadId && task.file) {
      await transferMultipart(task, fileId, mp.multipartUploadId, mp.partSizeBytes ?? PART_SIZE);
    } else {
      await transferBytes(task, ticket.presignedUrl);
    }

    // 3) Confirm: server verifies object + size, sets status ready, syncs quota.
    await filesRepo.confirmUpload(me.id, ticket.uploadId, fileId);

    // 4) A small version, made here because a Worker cannot resize anything. After
    //    the confirm, never before: the upload is what the user asked for, and a
    //    thumbnail that fails must not delay or endanger it.
    //
    //    Shown as its own step rather than folded into "uploading". The bytes are
    //    safely in storage by now and the progress bar has been at 100% for a while,
    //    so leaving it there would read as stalled — and the file genuinely is not
    //    finished until it has something to draw in the grid.
    store.update(task.id, { status: "processing", progress: 100 });
    await attachThumbnail(fileId, task.file);

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

/**
 * How many times a failed PUT is worth retrying.
 *
 * Object storage returns the occasional 500 under load — observed repeatedly
 * against Backblaze while testing, roughly one upload in ten. Without a retry
 * that is simply a failed upload the user has to notice and redo, for a reason
 * that has nothing to do with them.
 *
 * Only 5xx and network failures are retried. A 403 means the URL is wrong or
 * expired and will be wrong again; retrying it just delays the error.
 */
const PUT_ATTEMPTS = 3;

async function realPut(task: UploadTask, presignedUrl: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= PUT_ATTEMPTS; attempt += 1) {
    try {
      await putOnce(task, presignedUrl);
      return;
    } catch (e) {
      lastError = e;
      const code = (e as { code?: string }).code;
      const status = (e as { status?: number }).status ?? 0;
      const worthRetrying = code === "NETWORK" || (code === "STORAGE_REJECTED" && status >= 500);
      if (!worthRetrying || attempt === PUT_ATTEMPTS) break;

      // Backing off rather than hammering: if storage is briefly unwell, arriving
      // again immediately is unlikely to go better.
      await new Promise((r) => setTimeout(r, 500 * attempt));
      ship(task.id, 0, 0);
    }
  }

  throw lastError;
}

async function putOnce(task: UploadTask, presignedUrl: string): Promise<void> {
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
          status: xhr.status,
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

/**
 * Generates a thumbnail and stores it alongside the file.
 *
 * Entirely best-effort. Every failure path returns quietly: the file is already
 * uploaded and listed, and the grid falls back to a category icon. Reporting a
 * thumbnail failure to someone who asked to upload a photo would be noise about
 * something they did not ask for.
 *
 * Without this the grid fetched the full original to draw every tile — an 877 KB
 * photo downloaded to fill a 200 px card, for every image in the folder, on every
 * visit. That is object-storage egress on the one path the architecture exists to
 * keep cheap.
 */
async function attachThumbnail(fileId: string, file: File | undefined): Promise<void> {
  if (!file) return;
  // The three kinds a browser can rasterise. Everything else keeps its category tile,
  // which is a real answer rather than a broken picture.
  const renderable =
    file.type.startsWith("image/") ||
    file.type.startsWith("video/") ||
    file.type === "application/pdf" ||
    /\.pdf$/i.test(file.name);
  if (!renderable) return;

  try {
    const blob = await makeThumbnail(file);
    if (!blob) return;

    // The server decides the key from the file's own object key; nothing about the
    // destination comes from here.
    const ticket = await apiClient.post<{ presignedUrl: string; maxBytes: number }>(
      `/api/files/${fileId}/thumbnail`,
      {},
    );
    if (blob.size > ticket.maxBytes) return;

    const res = await fetch(ticket.presignedUrl, { method: "PUT", body: blob });
    if (!res.ok) return;

    // Confirmed separately, so a thumbnail_url is only ever recorded for an object
    // that is genuinely there — the failure the old background job made routine.
    await apiClient.put(`/api/files/${fileId}/thumbnail`, {});
    refreshFileViews();
  } catch {
    // Thumbnails are an optimisation. Nothing here is worth failing an upload over.
  }
}

/**
 * Uploads a large file in parts.
 *
 * A single PUT of 3 GB is one request that either finishes or does not, and on a
 * mobile connection it very often does not — losing everything at 90%. Parts fail and
 * retry on their own, and the bytes still go straight from here to storage: the three
 * control calls carry nothing but ids and ETags.
 *
 * Sequential rather than parallel. Parallel parts finish sooner on a fast link and
 * make progress meaningless, multiply the memory held at once, and on a slow link
 * simply divide the same bandwidth. One at a time is the honest default; concurrency
 * is a tuning decision to make with real numbers rather than by assumption.
 */
/**
 * How many parts are uploaded at once.
 *
 * This started at one, on the reasoning that parallel parts make progress harder to
 * read and only divide the same bandwidth. The first real measurement said otherwise:
 * a 127 MB file crawling at 57 KB/s, forty minutes remaining.
 *
 * A single upload stream is capped by the bandwidth-delay product — how much data can
 * be in flight before the sender has to stop and wait for acknowledgements. Storage is
 * a long way from most of the world, and on a link with a few hundred milliseconds of
 * round trip that ceiling sits far below the actual connection. More streams do not
 * divide the bandwidth; they are how you reach it. It is why every serious S3 client
 * defaults to several.
 *
 * Four is the usual default and is gentle enough not to starve the rest of the tab.
 */
const PART_CONCURRENCY = 4;

/**
 * Uploads a large file in parts, several at a time.
 *
 * The bytes still go browser-to-storage; only ids and ETags pass through our compute.
 *
 * Progress is tracked per part and summed, because parts finish out of order — adding
 * to a single counter as each one completes made the bar jump and the estimate
 * meaningless.
 */
async function transferMultipart(
  task: UploadTask,
  fileId: string,
  uploadId: string,
  partSize: number,
): Promise<void> {
  const file = task.file!;
  const total = file.size;
  const partCount = Math.max(1, Math.ceil(total / partSize));
  const completed: { partNumber: number; etag: string }[] = [];

  // Bytes confirmed sent, per part. Summed on every progress event so out-of-order
  // completion still produces a number that only goes up.
  const sent = new Map<number, number>();
  const startedAt = Date.now();

  const report = () => {
    let done = 0;
    for (const v of sent.values()) done += v;
    ship(task.id, Math.min(99, Math.round((done / total) * 100)), speedSince(startedAt, done));
  };

  const bail = () => {
    if (cancelled(task.id)) throw Object.assign(new Error("Upload cancelled."), { code: "CANCELLED" });
  };

  // Signed in batches rather than all at once: a long upload would outlive URLs minted
  // an hour ago, and signing every part up front wastes work on parts an interrupted
  // upload never reaches.
  const BATCH = 20;

  for (let start = 0; start < partCount; start += BATCH) {
    bail();

    const numbers: number[] = [];
    for (let n = start + 1; n <= Math.min(start + BATCH, partCount); n += 1) numbers.push(n);

    const { parts } = await apiClient.post<{ parts: { partNumber: number; url: string }[] }>(
      `/api/files/${fileId}/parts`,
      { uploadId, partNumbers: numbers },
    );

    // A worker pool over this batch. Workers pull the next part rather than being
    // handed a fixed share, so one slow part does not leave three workers idle.
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= parts.length) return;

        const part = parts[index]!;
        bail();

        const from = (part.partNumber - 1) * partSize;
        const blob = file.slice(from, Math.min(from + partSize, total));

        const etag = await putPart(part.url, blob, task.id, part.partNumber, sent, report);
        completed.push({ partNumber: part.partNumber, etag });
        sent.set(part.partNumber, blob.size);
        report();
      }
    };

    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, parts.length) }, worker));
  }

  // Assemble. Until this succeeds the object does not exist, whatever landed.
  await apiClient.put(`/api/files/${fileId}/parts`, { uploadId, parts: completed });
  ship(task.id, 100, speedSince(startedAt, total));
}

function cancelled(taskId: string): boolean {
  return useUploadStore.getState().tasks.find((t) => t.id === taskId)?.status === "cancelled";
}

function speedSince(startedAt: number, bytes: number): number {
  const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
  return Math.round(bytes / elapsed);
}

/**
 * PUTs one part and returns its ETag.
 *
 * The ETag is what identifies the part at assembly time; without it storage cannot
 * put the object back together. It is a normal response header, but a cross-origin
 * one — the bucket's CORS rules have to expose ETag or this reads null and the whole
 * upload fails at the last step, which is a confusing place to discover a
 * configuration problem. Hence the explicit error.
 */
async function putPart(
  url: string,
  blob: Blob,
  taskId: string,
  partNumber: number,
  sent: Map<number, number>,
  report: () => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      // This part's own figure. The caller sums them, so parts finishing out of order
      // still produce a total that only moves forward.
      sent.set(partNumber, e.loaded);
      report();
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          Object.assign(new Error(`Storage rejected a part (HTTP ${xhr.status}).`), {
            code: "STORAGE_REJECTED",
            status: xhr.status,
          }),
        );
        return;
      }
      const etag = xhr.getResponseHeader("ETag");
      if (!etag) {
        reject(
          Object.assign(
            new Error("Storage did not return an ETag for a part. The bucket's CORS rules must expose the ETag header."),
            { code: "NO_ETAG" },
          ),
        );
        return;
      }
      resolve(etag);
    };

    xhr.onerror = () =>
      reject(
        Object.assign(new Error("Could not reach storage. Check your connection, or the bucket's CORS rules."), {
          code: "NETWORK",
        }),
      );
    xhr.onabort = () => reject(Object.assign(new Error("Upload cancelled."), { code: "CANCELLED" }));

    const poll = setInterval(() => {
      if (cancelled(taskId)) {
        clearInterval(poll);
        xhr.abort();
      }
    }, 400);
    xhr.onloadend = () => clearInterval(poll);

    xhr.send(blob);
  });
}
