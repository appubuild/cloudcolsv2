"use client";

// Repository facade. Depending on DATA_LAYER, exposes either the mock (Phase 1)
// or API (Phase 2) implementations under identical names — so the React Query
// hook layer and every UI component need no changes to switch backends.

import { env } from "@/lib/config/env";
import {
  filesRepo as mockFiles,
  authRepo as mockAuth,
  planRepo as mockPlan,
  shareRepo as mockShare,
  subscriptionRepo as mockSub,
  developerRepo as mockDev,
  notificationRepo as mockNotif,
  adminRepo as mockAdmin,
  deriveCategory as mockDerive,
  CloudColsError as mockError,
} from "./mock";
import {
  apiFilesRepo,
  apiAuthRepo,
  apiPlanRepo,
  apiShareRepo,
  apiSubscriptionRepo,
  apiDeveloperRepo,
  apiNotificationRepo,
  apiAdminRepo,
} from "./api";

export const useApi = env.dataLayer === "api";

export const filesRepo = useApi ? apiFilesRepo : mockFiles;
export const authRepo = useApi ? apiAuthRepo : mockAuth;
export const planRepo = useApi ? apiPlanRepo : mockPlan;
export const shareRepo = useApi ? apiShareRepo : mockShare;
export const subscriptionRepo = useApi ? apiSubscriptionRepo : mockSub;
export const developerRepo = useApi ? apiDeveloperRepo : mockDev;
export const notificationRepo = useApi ? apiNotificationRepo : mockNotif;
export const adminRepo = useApi ? apiAdminRepo : mockAdmin;

export { mockDerive as deriveCategory, mockError as CloudColsError };
export type { FilesRepository } from "./types";
