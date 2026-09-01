"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { UploadTray } from "@/components/upload/upload-tray";
import { Toaster } from "@/components/ui/toaster";
import { useMe } from "@/lib/hooks/queries";
import { useAuthStore } from "@/lib/store/auth";
import { Spinner } from "@/components/ui/misc";

export function AppShell({
  children,
  title,
  onSearch,
}: {
  children: ReactNode;
  title?: string;
  onSearch?: (q: string) => void;
}) {
  const { data: me, isLoading } = useMe();
  const setUser = useAuthStore((s) => s.setUser);
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // Keep the zustand auth mirror in sync for non-hook consumers.
  useEffect(() => {
    if (me) setUser({ ...me } as any);
  }, [me, setUser]);

  useEffect(() => {
    if (!isLoading && !me) {
      router.push(`/login?returnTo=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, me, router, pathname]);

  if (isLoading || !me) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar onClose={() => setNavOpen(false)} />
      <div className="md:pl-64">
        <TopBar onMenu={() => setNavOpen(true)} title={title} onSearch={onSearch} />
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">{children}</main>
      </div>
      <UploadTray />
      <Toaster />
    </div>
  );
}
