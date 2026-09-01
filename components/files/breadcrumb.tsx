"use client";

import Link from "next/link";
import { ChevronRight, Folder } from "lucide-react";

export function Breadcrumb({ crumbs }: { crumbs: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
            {c.href && !last ? (
              <Link href={c.href} className="rounded px-1 py-0.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span className="flex items-center gap-1 px-1 py-0.5 font-medium text-foreground">
                {i === 0 && <Folder className="h-3.5 w-3.5 text-primary" />}
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
