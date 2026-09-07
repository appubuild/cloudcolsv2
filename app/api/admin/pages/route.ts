import "server-only";
import { handler, ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/adminAuth";
import { audit } from "@/lib/api/audit";
import { listPages, getPage, savePage, deletePage } from "@/lib/content/pages";
import { toSlug, RESERVED_SLUGS } from "@/lib/content/sanitize";

export const dynamic = "force-dynamic";

/** Every page, drafts included. */
export const GET = handler(async (req: Request) => {
  await requireAdmin(req, "support");
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");
  if (slug) {
    const page = await getPage(slug);
    if (!page) throw new ApiError("PAGE_NOT_FOUND", 404, "No such page.");
    return page;
  }
  return listPages();
});

interface Body {
  slug?: string;
  title?: string;
  html?: string;
  description?: string;
  published?: boolean;
  indexable?: boolean;
}

/**
 * Create or update a page.
 *
 * super_admin: these are published to the open internet under the product's own
 * domain, which is a different kind of act from answering a support ticket.
 *
 * The HTML is sanitised inside savePage, on the way to storage. It is not sanitised
 * again at render time, and that is deliberate — one place to get right rather than
 * every reader having to remember.
 */
export const PUT = handler(async (req: Request) => {
  const staff = await requireAdmin(req, "super_admin");
  const body = (await req.json()) as Body;

  const title = String(body.title ?? "").trim();
  if (!title || title.length > 120) throw new ApiError("INVALID_INPUT", 400, "A title of 1–120 characters is required.");

  // From the supplied slug, or the title when none was given.
  const slug = toSlug(body.slug || title);
  if (!slug) throw new ApiError("INVALID_INPUT", 400, "That title does not produce a usable web address.");
  if (RESERVED_SLUGS.has(slug)) {
    throw new ApiError("SLUG_RESERVED", 409, `"/${slug}" is used by the application. Pick another address.`);
  }

  const html = String(body.html ?? "");
  if (html.length > 400_000) throw new ApiError("TOO_LARGE", 413, "That page is too large.");

  const existed = Boolean(await getPage(slug));
  const page = await savePage(
    {
      slug,
      title,
      html,
      description: body.description,
      published: body.published,
      indexable: body.indexable,
    },
    // Not staff.id: site_content.updated_by references auth.users, and the admins
    // row id is a different uuid that fails the constraint.
    staff.userId,
  );

  await audit({
    actorId: staff.id,
    actorType: "admin",
    action: existed ? "page.update" : "page.create",
    targetType: "page",
    targetId: slug,
    metadata: { title, published: page.published, bytes: page.html.length },
  });

  return page;
});

export const DELETE = handler(async (req: Request) => {
  const staff = await requireAdmin(req, "super_admin");
  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) throw new ApiError("INVALID_INPUT", 400, "slug is required.");

  const page = await getPage(slug);
  if (!page) throw new ApiError("PAGE_NOT_FOUND", 404, "No such page.");

  await deletePage(slug);
  await audit({
    actorId: staff.id,
    actorType: "admin",
    action: "page.delete",
    targetType: "page",
    targetId: slug,
    metadata: { title: page.title },
  });

  return { deleted: true, slug };
});
