"use client";

/**
 * The actions a file supports, in one place.
 *
 * Download, share and "open in new tab" each existed as a toast that announced
 * something and then did nothing — three separate placeholders in the preview
 * overlay. Putting the real implementations here means the preview, the row menu
 * and the bulk toolbar all do the same thing, and there is one place to fix when
 * one of them is wrong.
 */

import { filesRepo } from "@/lib/repositories";
import { useAuthStore } from "@/lib/store/auth";
import { toast } from "@/lib/store/toast";
import type { File as CloudFile } from "@/lib/types";

function currentUserId(): string {
  return useAuthStore.getState().user?.id ?? "";
}

/** A short-lived URL for the file. `attachment` makes the browser save it. */
async function urlFor(fileId: string, disposition: "inline" | "attachment"): Promise<string> {
  const { url } = await filesRepo.getDownloadUrl(currentUserId(), fileId, disposition);
  return url;
}

/**
 * Saves the file to the user's device.
 *
 * The anchor points straight at storage, so the bytes never pass through the app
 * and a multi-gigabyte file is never held in browser memory. The filename and the
 * attachment disposition are signed into the URL by the server, which is what
 * makes the browser save rather than navigate — and save under the name the user
 * gave the file rather than its storage key.
 */
export async function downloadFile(file: Pick<CloudFile, "id" | "originalFilename">): Promise<void> {
  try {
    const url = await urlFor(file.id, "attachment");
    const a = document.createElement("a");
    a.href = url;
    a.download = file.originalFilename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("Download started", file.originalFilename);
  } catch (e) {
    toast.error("Download failed", (e as Error).message || "Could not reach the file.");
  }
}

/**
 * Opens the file in a new tab.
 *
 * The tab is opened synchronously, before the signed URL is fetched: a popup
 * opened from inside a promise callback is no longer part of the click that
 * caused it, and browsers block it. So the tab opens first and its location is
 * set once the URL arrives — and is closed again if it never does, rather than
 * leaving a blank tab behind.
 */
export async function openFileInNewTab(fileId: string): Promise<void> {
  const tab = window.open("", "_blank", "noopener,noreferrer");
  try {
    const url = await urlFor(fileId, "inline");
    if (tab) tab.location.href = url;
    // A blocked popup is not an error worth interrupting anyone over, but the
    // file should still open somewhere.
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    toast.error("Could not open the file", (e as Error).message || "Try again in a moment.");
  }
}

/** Copies a link to the file's page in CloudCols — not the signed storage URL. */
export async function copyItemLink(path: string): Promise<void> {
  const url = `${window.location.origin}${path}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied", url);
  } catch {
    // Clipboard access is refused in some browsers and contexts.
    toast.error("Could not copy", url);
  }
}
