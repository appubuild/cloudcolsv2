import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { sanitizeHtml, excerptFrom } from "./sanitize";

/**
 * CMS pages.
 *
 * Stored in `site_content`, the table the landing editor already uses, under keys of
 * the form `page:<slug>`. A dedicated table would be tidier, but this needs no schema
 * change — and the shape it would have had (a key and a JSON document) is what
 * `site_content` already is.
 */

const PREFIX = "page:";

export interface CmsPage {
  slug: string;
  title: string;
  /** Sanitised on the way in. Never sanitised on the way out — that is too late. */
  html: string;
  /** Shown in search results and social previews. */
  description: string;
  published: boolean;
  /** Whether search engines may index it. */
  indexable: boolean;
  updatedAt: string | null;
}

interface Row {
  key: string;
  content: Record<string, unknown>;
  updated_at: string | null;
}

function fromRow(row: Row): CmsPage {
  const c = row.content ?? {};
  const html = typeof c.html === "string" ? c.html : "";
  return {
    slug: String(row.key).slice(PREFIX.length),
    title: typeof c.title === "string" ? c.title : "Untitled",
    html,
    description: typeof c.description === "string" && c.description ? c.description : excerptFrom(html),
    published: c.published !== false,
    indexable: c.indexable !== false,
    updatedAt: row.updated_at,
  };
}

/** Every page, published or not. For the admin list. */
export async function listPages(): Promise<CmsPage[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("site_content")
    .select("key, content, updated_at")
    .like("key", `${PREFIX}%`)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(fromRow);
}

/** One page by slug, or null. */
export async function getPage(slug: string): Promise<CmsPage | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("site_content")
    .select("key, content, updated_at")
    .eq("key", `${PREFIX}${slug}`)
    .maybeSingle();
  return data ? fromRow(data as unknown as Row) : null;
}

/** One page, only if it is published. What a public route should ask for. */
export async function getPublishedPage(slug: string): Promise<CmsPage | null> {
  const page = await getPage(slug);
  return page?.published ? page : null;
}

export interface SavePage {
  slug: string;
  title: string;
  html: string;
  description?: string;
  published?: boolean;
  indexable?: boolean;
}

/**
 * Create or replace a page.
 *
 * The HTML is sanitised here, once, on the way into storage — so every reader gets
 * clean content without having to remember to ask for it. A reader that forgets is
 * the entire vulnerability.
 */
export async function savePage(input: SavePage, authUserId: string | null): Promise<CmsPage> {
  const html = sanitizeHtml(input.html);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("site_content")
    .upsert(
      {
        key: `${PREFIX}${input.slug}`,
        content: {
          title: input.title,
          html,
          description: input.description?.trim() || excerptFrom(html),
          published: input.published !== false,
          indexable: input.indexable !== false,
        },
        updated_at: new Date().toISOString(),
        // References auth.users, so the staff member's auth id — not their `admins`
        // row id, which is a different uuid that fails the constraint.
        updated_by: authUserId,
      },
      { onConflict: "key" },
    )
    .select("key, content, updated_at")
    .single();
  if (error) throw error;
  return fromRow(data as unknown as Row);
}

export async function deletePage(slug: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("site_content").delete().eq("key", `${PREFIX}${slug}`);
  if (error) throw error;
}
