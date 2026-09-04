"use client";

// React Query hooks. Every hook sits on top of the repository layer so the UI
// never touches a mock/prod implementation directly.

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { File, FileListParams, Plan, User, UploadTicket } from "@/lib/types";
import {
  adminRepo,
  authRepo,
  developerRepo,
  filesRepo,
  notificationRepo,
  planRepo,
  shareRepo,
  subscriptionRepo,
} from "@/lib/repositories";
import { useAuthStore } from "@/lib/store/auth";
import type { Paginated } from "@/lib/types";

// --- Query keys -----------------------------------------------------------
export const queryKeys = {
  me: ["me"] as const,
  plans: ["plans"] as const,
  files: (params: FileListParams) => ["files", params] as const,
  trash: ["trash"] as const,
  shared: ["shared"] as const,
  subscriptions: ["subscriptions"] as const,
  notifications: ["notifications"] as const,
  apiKeys: ["apiKeys"] as const,
  apiPlans: ["apiPlans"] as const,
  apiUsage: ["apiUsage"] as const,
  webhooks: ["webhooks"] as const,
  adminStats: ["adminStats"] as const,
  adminUsers: ["adminUsers"] as const,
  adminPayments: ["adminPayments"] as const,
};

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => authRepo.getCurrentUser(),
    staleTime: 60 * 1000,
  });
}

export function usePlans() {
  return useQuery({
    queryKey: queryKeys.plans,
    queryFn: () => planRepo.listActive(),
    staleTime: 60 * 1000,
  });
}

export function useFiles(params: FileListParams) {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: queryKeys.files(params),
    queryFn: () => filesRepo.getChildren(userId, params.folderId ?? null, params),
    enabled: !!userId,
    staleTime: 15 * 1000,
  });
}

export function useTrash() {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: queryKeys.trash,
    queryFn: () => filesRepo.listTrash(userId),
    enabled: !!userId,
  });
}

export function useUsageSummary() {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: ["usageSummary"],
    queryFn: () => filesRepo.usageSummary(userId),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

export function useFolders() {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: ["folders"],
    queryFn: () => filesRepo.listAllFolders(userId),
    enabled: !!userId,
    staleTime: 15 * 1000,
  });
}

export function useFavoriteFolders() {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: ["favoriteFolders"],
    queryFn: () => filesRepo.listFavoriteFolders(userId),
    enabled: !!userId,
    staleTime: 15 * 1000,
  });
}

export function useRecentFolders() {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: ["recentFolders"],
    queryFn: () => filesRepo.listRecentFolders(userId),
    enabled: !!userId,
    staleTime: 15 * 1000,
  });
}

export function useRecentAccess(limit = 8) {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: ["recentAccess", limit],
    queryFn: () => filesRepo.recentAccess(userId, limit),
    enabled: !!userId,
    staleTime: 15 * 1000,
  });
}

export function useShared() {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: queryKeys.shared,
    queryFn: () => shareRepo.listByOwner(userId),
    enabled: !!userId,
  });
}

/** Invitations addressed to me, or ones I sent. */
export function useInvitations(direction: "incoming" | "outgoing") {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: ["invitations", direction],
    queryFn: () => shareRepo.listInvitations(userId, direction),
    enabled: !!userId,
  });
}

export function useInvite() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["invitations"] });
    qc.invalidateQueries({ queryKey: queryKeys.notifications });
    // An accepted invitation changes what the recipient can see.
    qc.invalidateQueries({ queryKey: ["files"] });
    qc.invalidateQueries({ queryKey: ["folders"] });
  };
  return {
    invite: useMutation({
      mutationFn: (opts: {
        fileId?: string | null;
        folderId?: string | null;
        email: string;
        permission?: "viewer" | "editor";
        message?: string;
      }) => shareRepo.invite(useAuthStore.getState().user?.id!, opts),
      onSuccess: refresh,
    }),
    respond: useMutation({
      mutationFn: ({ id, action }: { id: string; action: "accept" | "decline" | "revoke" }) =>
        shareRepo.respondToInvitation(useAuthStore.getState().user?.id!, id, action),
      onSuccess: refresh,
    }),
  };
}

export function useSubscriptions() {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: queryKeys.subscriptions,
    queryFn: () => subscriptionRepo.currentForUser(userId),
    enabled: !!userId,
  });
}

export function useNotifications() {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => notificationRepo.list(userId),
    enabled: !!userId,
  });
}

export function useApiKeys() {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: () => developerRepo.keys(userId),
    enabled: !!userId,
  });
}

export function useApiPlans() {
  return useQuery({
    queryKey: queryKeys.apiPlans,
    queryFn: () => developerRepo.apiPlans(),
    staleTime: 60 * 1000,
  });
}

export function useApiUsage(days = 7) {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: queryKeys.apiUsage,
    queryFn: () => developerRepo.usage(userId, days),
    enabled: !!userId,
  });
}

export function useWebhooks() {
  const me = useMe();
  const userId = me.data?.id ?? "";
  return useQuery({
    queryKey: queryKeys.webhooks,
    queryFn: () => developerRepo.webhooks(userId),
    enabled: !!userId,
  });
}

// --- Admin ------------------------------------------------------------------
export function useAdminStats() {
  return useQuery({ queryKey: queryKeys.adminStats, queryFn: () => adminRepo.stats() });
}
export function useAdminUsers() {
  return useQuery({ queryKey: queryKeys.adminUsers, queryFn: () => adminRepo.users() });
}
export function useAdminPayments() {
  return useQuery({ queryKey: queryKeys.adminPayments, queryFn: () => adminRepo.payments() });
}

// --- Mutations ----------------------------------------------------------------
export function useMutateFiles() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["files"] });
    qc.invalidateQueries({ queryKey: ["trash"] });
  };
  return {
    invalidate,
    createFolder: useMutation({
      mutationFn: ({ parentId, name }: { parentId: string | null; name: string }) =>
        filesRepo.createFolder(useAuthStore.getState().user?.id!, parentId, name),
      onSuccess: invalidate,
    }),
    rename: useMutation({
      mutationFn: ({ fileId, name }: { fileId: string; name: string }) =>
        filesRepo.rename(useAuthStore.getState().user?.id!, fileId, name),
      onSuccess: invalidate,
    }),
    renameFolder: useMutation({
      mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
        filesRepo.renameFolder(useAuthStore.getState().user?.id!, folderId, name),
      onSuccess: invalidate,
    }),
    moveToFolder: useMutation({
      mutationFn: ({ ids, target }: { ids: string[]; target: string | null }) =>
        filesRepo.moveToFolder(useAuthStore.getState().user?.id!, ids, target),
      onSuccess: invalidate,
    }),
    toggleFavorite: useMutation({
      mutationFn: (fileId: string) =>
        filesRepo.toggleFavorite(useAuthStore.getState().user?.id!, fileId),
      onSuccess: invalidate,
    }),
    toggleFolderPin: useMutation({
      mutationFn: (folderId: string) => filesRepo.toggleFolderPin(useAuthStore.getState().user?.id!, folderId),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["files"] });
        qc.invalidateQueries({ queryKey: ["folders"] });
        qc.invalidateQueries({ queryKey: ["recentFolders"] });
      },
    }),
    setFolderIcon: useMutation({
      mutationFn: ({ folderId, icon }: { folderId: string; icon: string | null }) =>
        filesRepo.setFolderIcon(useAuthStore.getState().user?.id!, folderId, icon),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["files"] });
        qc.invalidateQueries({ queryKey: ["folders"] });
        qc.invalidateQueries({ queryKey: ["favoriteFolders"] });
        qc.invalidateQueries({ queryKey: ["recentFolders"] });
      },
    }),
    toggleFolderFavorite: useMutation({
      mutationFn: (folderId: string) =>
        filesRepo.toggleFolderFavorite(useAuthStore.getState().user?.id!, folderId),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["favoriteFolders"] });
        qc.invalidateQueries({ queryKey: ["folders"] });
        qc.invalidateQueries({ queryKey: ["files"] });
      },
    }),
    markAccessed: useMutation({
      mutationFn: ({ type, id }: { type: "file" | "folder"; id: string }) =>
        filesRepo.markAccessed(useAuthStore.getState().user?.id!, type, id),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["recentAccess"] }),
    }),
    trash: useMutation({
      mutationFn: (ids: string[]) => filesRepo.trash(useAuthStore.getState().user?.id!, ids),
      onSuccess: invalidate,
    }),
    restore: useMutation({
      mutationFn: (ids: string[]) => filesRepo.restore(useAuthStore.getState().user?.id!, ids),
      onSuccess: invalidate,
    }),
    destroy: useMutation({
      mutationFn: (ids: string[]) => filesRepo.destroy(useAuthStore.getState().user?.id!, ids),
      onSuccess: invalidate,
    }),
  };
}

export function useUpload() {
  const qc = useQueryClient();
  const createTicket = useMutation({
    mutationFn: ({ filename, sizeBytes }: { filename: string; sizeBytes: number }) =>
      filesRepo.createUploadTicket(useAuthStore.getState().user?.id!, filename, sizeBytes),
  });
  const confirm = useMutation({
    mutationFn: ({ uploadId, fileId }: { uploadId: string; fileId: string }) =>
      filesRepo.confirmUpload(useAuthStore.getState().user?.id!, uploadId, fileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["files"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  return { createTicket, confirm };
}

export function useShare() {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (opts: { fileId?: string; folderId?: string; permission: "view" | "download"; expiresAt?: string | null }) =>
      shareRepo.create(useAuthStore.getState().user?.id!, opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared"] }),
  });
  const revoke = useMutation({
    mutationFn: (shareId: string) => shareRepo.revoke(useAuthStore.getState().user?.id!, shareId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shared"] }),
  });
  return { create, revoke };
}

export function useSubscription() {
  const qc = useQueryClient();
  const checkout = useMutation({
    mutationFn: ({ planId, provider }: { planId: string; provider: string }) =>
      subscriptionRepo.checkout(useAuthStore.getState().user?.id!, planId, provider),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const cancel = useMutation({
    mutationFn: () => subscriptionRepo.cancel(useAuthStore.getState().user?.id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  return { checkout, cancel };
}

export function useDeveloper() {
  const qc = useQueryClient();
  const createKey = useMutation({
    mutationFn: ({ label, scopes }: { label: string; scopes: string[] }) =>
      developerRepo.createKey(useAuthStore.getState().user?.id!, label, scopes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apiKeys"] }),
  });
  const revokeKey = useMutation({
    mutationFn: (keyId: string) => developerRepo.revokeKey(useAuthStore.getState().user?.id!, keyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apiKeys"] }),
  });
  const createWebhook = useMutation({
    mutationFn: ({ url, events }: { url: string; events: string[] }) =>
      developerRepo.createWebhook(useAuthStore.getState().user?.id!, url, events),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
  const updateWebhook = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<any> }) =>
      developerRepo.updateWebhook(useAuthStore.getState().user?.id!, id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
  const deleteWebhook = useMutation({
    mutationFn: (id: string) => developerRepo.deleteWebhook(useAuthStore.getState().user?.id!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
  return { createKey, revokeKey, createWebhook, updateWebhook, deleteWebhook };
}

export function useNotificationsMutations() {
  const qc = useQueryClient();
  const markRead = useMutation({
    mutationFn: (id: string) => notificationRepo.markRead(useAuthStore.getState().user?.id!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAllRead = useMutation({
    mutationFn: () => notificationRepo.markAllRead(useAuthStore.getState().user?.id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  return { markRead, markAllRead };
}

export type { Paginated, UploadTicket, File };
