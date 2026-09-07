"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

/**
 * The server's public settings.
 *
 * Presentational only — whether an ad slot exists, whether registration is open,
 * whether to show the maintenance notice. The server re-checks every one of these
 * when it actually decides anything, so nothing here is load-bearing for security.
 */
export interface PublicSettings {
  ads_enabled: boolean;
  ads_config: { providerId: string; placements: Record<string, boolean> };
  maintenance_mode: boolean;
  registration_enabled: boolean;
  max_file_size_bytes: number;
  trash_retention_days: number;
  trash_counts_toward_quota: boolean;
}

export function usePublicSettings() {
  return useQuery<Partial<PublicSettings>>({
    queryKey: ["publicSettings"],
    queryFn: () => apiClient.get<Partial<PublicSettings>>("/api/settings"),
    // Configuration, not content: worth a long stale time, and a failure should not
    // retry in a loop on every mounted ad slot.
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
