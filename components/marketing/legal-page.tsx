import type { ReactNode } from "react";
import { getPublishedPage } from "@/lib/content/pages";

/**
 * A legal page: the admin's version if one is published, the built-in one otherwise.
 *
 * The CMS already stores pages under `page:<slug>` (lib/content/pages.ts), so an admin
 * who publishes a page with the slug "privacy", "terms" or "security" replaces the
 * built-in text here without a deploy. Until then the built-in text is shown — it
 * describes what the service actually does, and it is written to be reviewed and
 * replaced, not to stand as legal advice.
 */

const PROSE =
  "mt-8 text-foreground [&_a]:text-primary [&_a]:underline [&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-6";

export async function LegalPage({
  slug,
  title,
  children,
}: {
  slug: string;
  title: string;
  children: ReactNode;
}) {
  // A CMS outage must not take the legal pages down with it; fall back to the built-in text.
  const page = await getPublishedPage(slug).catch(() => null);

  if (page) {
    return (
      <article className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-bold text-foreground sm:text-4xl">{page.title}</h1>
        {page.updatedAt && (
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated {new Date(page.updatedAt).toLocaleDateString()}
          </p>
        )}
        {/* Sanitised when saved — see lib/content/sanitize. */}
        <div className={PROSE} dangerouslySetInnerHTML={{ __html: page.html }} />
      </article>
    );
  }

  return (
    <article className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold text-foreground sm:text-4xl">{title}</h1>
      <div className={PROSE}>{children}</div>
    </article>
  );
}
