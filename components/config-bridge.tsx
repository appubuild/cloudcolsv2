"use client";

import { useMemo } from "react";
import { setPublicConfig, type PublicConfig } from "@/lib/config/public-config";

/**
 * Carries the server's public configuration into the browser.
 *
 * Assigned during render rather than in an effect, so it is in place before any
 * child renders or any repository call reads it. Renders nothing.
 */
export function ConfigBridge(config: PublicConfig) {
  useMemo(() => setPublicConfig(config), [config.supabaseUrl, config.supabaseAnonKey]);
  return null;
}
