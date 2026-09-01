"use client";

import { create } from "zustand";
import { uuid } from "@/lib/utils";

export type UploadStatus = "queued" | "uploading" | "success" | "error" | "cancelled";

export interface UploadTask {
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType?: string;
  progress: number; // 0–100
  status: UploadStatus;
  speedBytesPerSec: number;
  errorCode?: string;
  errorMessage?: string;
  uploadId?: string;
  fileId?: string;
  folderId: string | null;
  createdAt: number;
}

interface UploadState {
  open: boolean;
  tasks: UploadTask[];
  setOpen: (open: boolean) => void;
  addTasks: (tasks: { filename: string; sizeBytes: number; mimeType?: string; folderId: string | null }[]) => void;
  update: (id: string, patch: Partial<UploadTask>) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  clearCompleted: () => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  open: false,
  tasks: [],
  setOpen: (open) => set({ open }),
  addTasks: (items) =>
    set((s) => ({
      open: true,
      tasks: [
        ...s.tasks,
        ...items.map((t) => ({
          ...t,
          id: uuid(),
          createdAt: Date.now(),
          progress: 0,
          status: "queued" as const,
          speedBytesPerSec: 0,
          errorCode: undefined,
          errorMessage: undefined,
          uploadId: undefined,
          fileId: undefined,
        })),
      ],
    })),
  update: (id, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  cancel: (id) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id && (t.status === "queued" || t.status === "uploading")
          ? { ...t, status: "cancelled" }
          : t
      ),
    })),
  retry: (id) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, status: "queued", progress: 0, errorCode: undefined, errorMessage: undefined } : t
      ),
    })),
  remove: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  clearCompleted: () =>
    set((s) => ({ tasks: s.tasks.filter((t) => !["success", "cancelled", "error"].includes(t.status)) })),
}));
