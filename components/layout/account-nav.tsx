"use client";

import Link from "next/link";
import { useAuthStore } from "@/lib/store/auth";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/layout/avatar";

/**
 * The marketing header's right-hand side.
 *
 * Offering "Sign in" to someone who is already signed in is a dead end — they
 * click it, land on a form they do not need, and have to find their own way back.
 * When there is a session the header shows who it belongs to and points at the app.
 */
export function AccountNav() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);

  // Nothing until the session is known. Rendering "Sign in" first and swapping it a
  // moment later is worse than a brief gap: the wrong answer is on screen long
  // enough to click.
  if (loading) return <span className="h-9 w-[132px]" aria-hidden />;

  if (!user) {
    return (
      <>
        <Link href="/login">
          <Button variant="ghost">Sign in</Button>
        </Link>
        <Link href="/register">
          <Button>Get started</Button>
        </Link>
      </>
    );
  }

  return (
    <Link href="/app" className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-surface-2">
      <Avatar name={user.name} url={user.avatarUrl ?? undefined} size={30} />
      <span className="hidden text-sm font-medium text-foreground sm:block">Dashboard</span>
    </Link>
  );
}
