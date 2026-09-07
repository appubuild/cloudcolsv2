import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedPage } from "@/lib/content/pages";

/**
 * A page an admin wrote.
 *
 * Inside the marketing group, so it gets the site header and footer — a terms page
 * with no way back to the product is a dead end.
 *
 * Rendered on demand. Content is edited from the admin panel and has to appear when
 * it is saved, not at the next deploy.
 */
export const dynamic = "force-dynamic";

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedPage(slug);
  if (!page) return { title: "Page not found", robots: { index: false, follow: false } };

  return {
    title: page.title,
    description: page.description,
    robots: page.indexable ? undefined : { index: false, follow: false },
    openGraph: { type: "article", title: page.title, description: page.description, siteName: "CloudCols" },
  };
}

export default async function CmsPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const page = await getPublishedPage(slug);

  // A draft is not found rather than forbidden: whether an unpublished page exists at
  // an address is not something a visitor needs told.
  if (!page) notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold text-foreground sm:text-4xl">{page.title}</h1>
      {page.updatedAt && (
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated {new Date(page.updatedAt).toLocaleDateString()}
        </p>
      )}
      {/*
        Sanitised when it was saved, not here. One place to get right beats every
        reader remembering — and a reader that forgets is the whole vulnerability.
        See lib/content/sanitize.
      */}
      <div
        className="mt-8 text-foreground [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_h1]:mb-3 [&_h1]:mt-8 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_hr]:my-6 [&_hr]:border-border [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-6"
        dangerouslySetInnerHTML={{ __html: page.html }}
      />
    </article>
  );
}
