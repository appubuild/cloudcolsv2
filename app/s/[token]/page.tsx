import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent } from "@/components/ui/card";
import { resolveShare, countShareAccess } from "@/lib/api/shares";
import { formatBytes } from "@/lib/utils";
import { Timer, ShieldAlert, Link2 } from "lucide-react";
import { ShareView } from "./share-view";

/**
 * A shared file, rendered on the server.
 *
 * This page was `"use client"` with no metadata: it shipped an empty shell, fetched
 * the share in the browser, and gave every crawler and every chat app the same
 * generic HTML. Server-rendered share previews on the primary domain were the single
 * biggest reason this product is Next.js rather than Flutter Web, and the one page
 * that needed it did not do it.
 *
 * Rendered per request rather than cached: a link can be revoked or expire at any
 * moment, and a cached page would keep showing a file that is no longer shared.
 */
export const dynamic = "force-dynamic";

type Params = { token: string };

/** What the file is called, for a title. */
function subjectOf(state: Awaited<ReturnType<typeof resolveShare>>): string | null {
  if (state.kind !== "ready") return null;
  return state.file?.originalFilename ?? state.folder?.name ?? null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { token } = await params;
  const state = await resolveShare(token);
  const name = subjectOf(state);

  if (!name || state.kind !== "ready") {
    return {
      // The root layout's template appends " · CloudCols"; adding it here too gave
      // titles like "photo.png · CloudCols · CloudCols".
      title: "This link is not available",
      // A dead link should not accumulate search results. `noindex` on the failure
      // path only — a live share is meant to be previewable.
      robots: { index: false, follow: false },
    };
  }

  const description = state.file
    ? `${state.file.category} · ${formatBytes(state.file.sizeBytes)} · shared via CloudCols`
    : "A folder shared via CloudCols";

  /**
   * The thumbnail, where there is one.
   *
   * It costs the Worker a few tens of kilobytes to proxy, which is what thumbnails
   * exist for, and it grants nothing new: anyone holding this token can already
   * fetch the file itself. A file with no thumbnail gets no image rather than a
   * placeholder that would look like a broken preview in every chat app.
   */
  const image = state.file?.hasThumbnail ? `/s/${encodeURIComponent(token)}/preview` : undefined;

  return {
    title: name,
    description,
    // Shared links are meant to be opened by people who were sent them, not found in
    // a search engine. Previews still work: crawlers for chat apps read Open Graph
    // tags regardless of robots.
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      title: name,
      description,
      siteName: "CloudCols",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: name,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function SharePage({ params }: { params: Promise<Params> }) {
  const { token } = await params;
  const state = await resolveShare(token);

  // Counted here, where a person is looking at the page — not in generateMetadata,
  // which also runs for crawlers, and not in the resolver, which both call.
  if (state.kind === "ready") {
    await countShareAccess(state.share.id, state.share.accessCount);
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border px-4">
        <Link href="/"><Logo size={28} /></Link>
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">Sign in</Link>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        {state.kind === "not_found" && (
          <StateCard icon={<Link2 className="h-8 w-8" />} title="This link is not available" desc="It may have been removed by the owner." />
        )}
        {state.kind === "revoked" && (
          <StateCard icon={<ShieldAlert className="h-8 w-8" />} title="This link is no longer available" desc="The owner revoked access." />
        )}
        {state.kind === "expired" && (
          <StateCard icon={<Timer className="h-8 w-8" />} title="This link has expired" desc="Ask the owner to share again." />
        )}
        {state.kind === "ready" && (
          <ShareView
            token={token}
            permission={state.share.permission}
            file={state.file}
            folderName={state.folder?.name ?? null}
          />
        )}
      </main>
    </div>
  );
}

function StateCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Card className="max-w-sm">
      <CardContent className="flex flex-col items-center py-12 text-center">
        <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">{icon}</span>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}
