"use client";

import { create } from "zustand";
import { uuid } from "@/lib/utils";

export type ToastKind = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 4500;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = uuid();
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (title: string, message?: string) => useToastStore.getState().push({ kind: "success", title, message }),
  error: (title: string, message?: string) => useToastStore.getState().push({ kind: "error", title, message }),
  info: (title: string, message?: string) => useToastStore.getState().push({ kind: "info", title, message }),
  warning: (title: string, message?: string) => useToastStore.getState().push({ kind: "warning", title, message }),
};
