"use client";

import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useUiStore, applyTheme } from "@/lib/store/ui";
import type { ReactNode } from "react";
import { queryClient } from "@/lib/query-client";

export function Providers({ children }: { children: ReactNode }) {
  const theme = useUiStore((s) => s.theme);

  // Apply theme to <html> whenever it changes.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
