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

/**
 * The real backend unless mock data was explicitly asked for.
 *
 * This used to be `=== "api"`, so anything other than that exact value — most
 * often the variable simply not reaching the build, since NEXT_PUBLIC_* are
 * inlined at build time and a runtime copy is invisible to the browser — meant
 * mock. A deployment with a working backend then served fabricated data: sign-in
 * succeeded, uploads reported success, files appeared, and nothing was stored.
 *
 * Defaulting the other way makes the failure honest. A missing backend now shows
 * errors, which is a problem someone can act on; fabricated data is not.
 */
export const useApi = env.dataLayer !== "mock";

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
