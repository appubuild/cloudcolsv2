"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Search, Sun, Moon, Menu as MenuIcon, LogOut, User as UserIcon, ArrowUpRight, X } from "lucide-react";
import { useUiStore } from "@/lib/store/ui";
import { useMe, useNotifications, useNotificationsMutations } from "@/lib/hooks/queries";
import { authRepo } from "@/lib/repositories";
import { toast } from "@/lib/store/toast";
import { Avatar } from "./avatar";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown";
import { Badge } from "@/components/ui/misc";
import { timeAgo } from "@/lib/utils";

export function TopBar({
  onMenu,
  title,
  onSearch,
}: {
  onMenu?: () => void;
  title?: string;
  onSearch?: (q: string) => void;
}) {
  const { theme, toggleTheme } = useUiStore();
  const { data: me } = useMe();
  const { data: notifications } = useNotifications();
  const { markAllRead, markRead } = useNotificationsMutations();
  const router = useRouter();
  const [q, setQ] = useState("");

  const unread = notifications?.filter((n) => !n.isRead).length ?? 0;

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSearch) onSearch(q);
    else if (q.trim()) router.push(`/app/files?search=${encodeURIComponent(q)}`);
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur">
      {onMenu && (
        <button
          onClick={onMenu}
          aria-label="Toggle navigation"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 md:hidden"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      )}
      {title && <h1 className="hidden text-sm font-semibold text-foreground md:block">{title}</h1>}

      <form onSubmit={submitSearch} className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search files…"
          className="h-9 w-full rounded-md border border-border bg-surface-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="rounded-md p-2 text-muted-foreground hover:bg-surface-2"
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <Dropdown
          trigger={
            <button aria-label="Notifications" className="relative rounded-md p-2 text-muted-foreground hover:bg-surface-2">
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>
          }
        >
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unread > 0 && (
              <button onClick={() => markAllRead.mutate()} className="text-xs font-medium text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <DropdownSeparator />
          <div className="max-h-72 overflow-auto">
            {notifications?.length ? (
              notifications.map((n) => (
                <DropdownItem key={n.id} onClick={() => markRead.mutate(n.id)}>
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {!n.isRead && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      {n.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{n.body}</span>
                    <span className="text-[11px] text-muted-foreground/70">{timeAgo(n.createdAt)}</span>
                  </span>
                </DropdownItem>
              ))
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications</p>
            )}
          </div>
        </Dropdown>

        <Dropdown
          trigger={
            <button className="flex items-center gap-2 rounded-md p-1 hover:bg-surface-2">
              <Avatar name={me?.name ?? "U"} url={me?.avatarUrl ?? undefined} size={30} />
            </button>
          }
        >
          <DropdownLabel>Signed in as</DropdownLabel>
          <div className="px-2.5 pb-1">
            <p className="text-sm font-medium text-foreground">{me?.name}</p>
            <p className="text-xs text-muted-foreground">{me?.email}</p>
            <Badge tone={me?.planId === "plan_free" ? "muted" : "info"} className="mt-1.5">
              {me?.planId === "plan_free" ? "Free" : "Plus/Pro"}
            </Badge>
          </div>
          <DropdownSeparator />
          <DropdownItem icon={<UserIcon className="h-4 w-4" />} onClick={() => router.push("/app/settings")}>
            Account settings
          </DropdownItem>
          <DropdownItem icon={<ArrowUpRight className="h-4 w-4" />} onClick={() => router.push("/developers")}>
            Developer portal
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem
            icon={<LogOut className="h-4 w-4" />}
            danger
            onClick={async () => {
              await authRepo.signOut();
              toast.info("Signed out", "You have been logged out.");
              router.push("/login");
            }}
          >
            Sign out
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
