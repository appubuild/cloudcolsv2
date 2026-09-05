"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { MockDataBanner } from "@/components/layout/mock-data-banner";
import { AccountSetup } from "@/components/layout/account-setup";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MockDataBanner />
      <AppShell>{children}</AppShell>
      <AccountSetup />
    </>
  );
}
