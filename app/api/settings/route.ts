import "server-only";
import { handler } from "@/lib/api/auth";
import { getPublicSettings } from "@/lib/settings/system";

export const dynamic = "force-dynamic";

/**
 * The settings a browser is allowed to know.
 *
 * Only keys declared `isPublic` in lib/settings/system. Everything the client reads
 * here is presentational — whether to render an ad slot, whether to show the
 * maintenance notice, what upload size to reject in the picker before bothering the
 * server. None of it is trusted: the server re-checks the same settings when it
 * actually decides anything, because a client can send whatever it likes.
 *
 * Unauthenticated on purpose. The marketing site and the sign-up page need
 * registration_enabled and maintenance_mode before anyone has signed in.
 */
export const GET = handler(async () => getPublicSettings());
