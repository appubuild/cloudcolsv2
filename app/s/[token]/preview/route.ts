import "server-only";
import { resolveShare } from "@/lib/api/shares";
import { getPresignedDownloadUrl } from "@/lib/services/b2";
import { thumbnailKey } from "@/lib/storage/derivatives";

export const dynamic = "force-dynamic";

type Params = { token: string };

/**
 * The Open Graph image for a share link: the file's thumbnail.
 *
 * Proxied rather than redirected. A redirect would hand the crawler a presigned
 * storage URL, and those get cached and re-shared by preview services — a capability
 * URL escaping into somebody else's cache is not something to do casually. Serving
 * the bytes keeps the signed URL inside this Worker.
 *
 * Proxying is only acceptable because it is a thumbnail: tens of kilobytes, which is
 * what thumbnails were built for. The file itself is never served this way — that is
 * the presigned download, straight from storage, exactly as invariant #1 requires.
 *
 * It grants nothing new. Anyone holding this token can already fetch the whole file.
 */
export async function GET(_req: Request, ctx: { params: Promise<Params> }): Promise<Response> {
  const { token } = await ctx.params;
  const state = await resolveShare(token);

  if (state.kind !== "ready" || !state.file?.hasThumbnail) {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const key = thumbnailKey(state.file.objectKey);
  const { presignedUrl } = await getPresignedDownloadUrl(key, 120, { contentType: "image/webp" });

  const upstream = await fetch(presignedUrl);
  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "image/webp",
      // Public, because the page it belongs to is public to anyone with the token,
      // and the URL carries that token. Short, so revoking a link stops the preview
      // within minutes rather than whenever a crawler decides to look again.
      "cache-control": "public, max-age=300",
    },
  });
}
