"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CategoryThumb } from "@/components/files/category-thumb";
import { toast } from "@/lib/store/toast";
import { formatBytes, formatDate } from "@/lib/utils";
import { FileText, Download } from "lucide-react";
import type { FileCategory } from "@/lib/types";

/**
 * The interactive half of a share page.
 *
 * The page itself is a server component so the file's name reaches crawlers and
 * social previews in the HTML. Only the two buttons need a browser, so only they
 * live here.
 */
export function ShareView({
  token,
  permission,
  file,
  folderName,
}: {
  token: string;
  permission: "view" | "download";
  file: { originalFilename: string; category: string; sizeBytes: number; createdAt: string } | null;
  folderName: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const name = file?.originalFilename ?? folderName ?? "Folder";

  /**
   * Asks for a signed URL at the moment it is needed and follows it.
   *
   * Not fetched when the page loaded: the URL lives five minutes, and someone who
   * leaves the tab open and comes back should not meet a failure they cannot explain.
   *
   * `location.assign` rather than an anchor with `download` — the bytes live on
   * storage's origin, and a cross-origin `download` attribute is ignored. The signed
   * URL already carries the disposition and the filename, so letting the browser
   * follow it does the right thing for both kinds of link.
   */
  const open = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/shares/download?token=${encodeURIComponent(token)}`);
      const body = (await res.json()) as
        | { ok: true; data: { url: string } }
        | { ok: false; error: { message: string } };
      if (!res.ok || body.ok === false) {
        throw new Error(body.ok === false ? body.error.message : "That did not work.");
      }
      window.location.assign(body.data.url);
    } catch (e) {
      toast.error("Could not open the file", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const link = window.location.href;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      // Clipboard access is refused outside a secure context and in some browsers.
      // Saying so beats claiming a copy that did not happen.
      toast.info("Copy this link", link);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardContent className="py-10 text-center">
        {file ? (
          <CategoryThumb category={file.category as FileCategory} className="mx-auto mb-4 h-14 w-14" />
        ) : (
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <FileText className="h-6 w-6" />
          </span>
        )}
        <h2 className="text-lg font-semibold text-foreground">{name}</h2>
        {file && (
          <p className="mt-1 text-sm text-muted-foreground">
            {file.category} · {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Shared via CloudCols · {permission === "download" ? "Download allowed" : "View only"}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          {/* Folder shares have nothing to hand over yet; the endpoint says so, and
              offering the button would only produce that message. */}
          {file && (
            <Button variant="secondary" onClick={open} disabled={busy}>
              <Download className="h-4 w-4" />
              {busy ? "Preparing…" : permission === "download" ? "Download" : "Open"}
            </Button>
          )}
          <Button variant="ghost" onClick={copy}>Copy link</Button>
        </div>
      </CardContent>
    </Card>
  );
}
