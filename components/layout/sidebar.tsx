"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { appNav } from "@/lib/nav";
import { Icon } from "@/components/ui/icon";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/hooks/queries";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/utils";
import { X } from "lucide-react";

export function Sidebar({ open, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const { data: me } = useMe();
  const quotaPct = me ? Math.min(100, (me.storageUsedBytes / me.storageQuotaBytes) * 100) : 0;

  const isActive = (href: string) => {
    if (href === "/app") return pathname === "/app";
    return pathname.startsWith(href);
  };

  const nav = (
    <>
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <Link href="/app" onClick={onClose}>
          <Logo size={28} />
        </Link>
        <button onClick={onClose} aria-label="Close menu" className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 md:hidden">
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {appNav.map((group) => (
          <div key={group.section} className="mb-4">
            <p className="px-2.5 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.section}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-primary-soft text-primary"
                          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                      )}
                    >
                      <Icon name={item.icon} className="h-[18px] w-[18px]" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-4">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium">{formatBytes(me?.storageUsedBytes ?? 0)} used</span>
          <span>{formatBytes(me?.storageQuotaBytes ?? 0)}</span>
        </div>
        <Progress value={quotaPct} />
        <Link
          href="/app/storage"
          onClick={onClose}
          className="mt-3 flex h-8 w-full items-center justify-center rounded-md border border-border bg-surface-2 text-[13px] font-medium text-foreground hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          Manage storage
        </Link>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-border bg-surface">
            {nav}
          </aside>
        </div>
      )}
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface md:flex">
        {nav}
      </aside>
    </>
  );
}
