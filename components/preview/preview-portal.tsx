"use client";

import { useEffect, useState } from "react";
import { X, Download, Share2, Star, ExternalLink } from "lucide-react";
import type { File } from "@/lib/types";
import { filesRepo } from "@/lib/repositories";
import { useAuthStore } from "@/lib/store/auth";
import { Spinner, Badge } from "@/components/ui/misc";
import { CategoryThumb } from "@/components/files/category-thumb";
import { TextEditor } from "./text-editor";
import { isTextEditable, TEXT_EDIT_MAX_BYTES } from "@/lib/services/fileTypes";
import { useFileUrl } from "@/lib/hooks/useFileUrl";
import { formatBytes } from "@/lib/utils";
import { toast } from "@/lib/store/toast";
import { downloadFile, openFileInNewTab } from "@/lib/services/fileActions";

export function PreviewPortal({
  fileId,
  onClose,
  startEditing = false,
}: {
  fileId: string | null;
  onClose: () => void;
  /** Opened from "Edit" rather than "Preview": skip the reading view. */
  startEditing?: boolean;
}) {
  const me = useAuthStore((s) => s.user);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fileId || !me) {
      setFile(null);
      return;
    }
    let active = true;
    setLoading(true);
    filesRepo
      .get(me.id, fileId)
      .then((f) => {
        if (active && f) setFile(f);
        // Record the open so it appears in Recent Access.
        if (f) filesRepo.markAccessed(me.id, "file", fileId).catch(() => {});
      })
      .catch(() => active && setFile(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [fileId, me]);

  useEffect(() => {
    if (!fileId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [fileId, onClose]);

  if (!fileId) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5 text-white">
        <div className="flex min-w-0 items-center gap-3">
          {file && (
            <>
              <CategoryThumb category={file.category} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{file.originalFilename}</p>
                <p className="truncate text-xs text-white/60">
                  {file.category} · {formatBytes(file.sizeBytes)}
                </p>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => file && void downloadFile(file)}
            aria-label="Download"
            className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Download className="h-5 w-5" />
          </button>
          <button
            onClick={() => toast.info("Share", "Share via the file menu.")}
            aria-label="Share"
            className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Share2 className="h-5 w-5" />
          </button>
          <button
            onClick={() => file && void openFileInNewTab(file.id)}
            aria-label="Open externally"
            className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <ExternalLink className="h-5 w-5" />
          </button>
          <button onClick={onClose} aria-label="Close preview" className="rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
        {loading ? (
          <Spinner className="h-8 w-8" />
        ) : !file ? (
          <div className="text-center text-white/70">Preview not available.</div>
        ) : (
          <FileRenderer file={file} startEditing={startEditing} />
        )}
      </div>
    </div>
  );
}

/**
 * Renders the actual file.
 *
 * Every branch here used to be a placeholder: images drew an SVG with the
 * filename on it, and video and audio pointed at empty data: URLs. Nothing ever
 * showed the file. They now read from a short-lived signed URL, so the bytes come
 * straight from storage and never through the app.
 */
function FileRenderer({ file, startEditing }: { file: File; startEditing?: boolean }) {
  const cat = file.category;

  /**
   * Text gets an editor rather than a viewer.
   *
   * Not by category — a .md is a "document" and a .json is "other", and both are text
   * somebody may want to fix a line of. The filename and the stored type decide,
   * which is the same rule the server applies when it refuses to edit a .docx.
   *
   * Large files are shown but not opened in the editor: pulling a 200 MB log into a
   * textarea would hang the tab.
   */
  const isText = isTextEditable(file.originalFilename, file.mimeType) && file.sizeBytes <= TEXT_EDIT_MAX_BYTES;
  const previewable = isText || cat === "image" || cat === "video" || cat === "audio" || cat === "pdf";
  const { data, isLoading, isError } = useFileUrl(file.id, previewable);

  if (previewable && isLoading) {
    return <Spinner className="h-8 w-8" />;
  }

  if (previewable && (isError || !data?.url)) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-white/70">
        <CategoryThumb category={cat} className="mb-4" />
        <p className="text-sm font-medium">{file.originalFilename}</p>
        <p className="mt-3 text-xs">This file could not be opened. Try again in a moment.</p>
      </div>
    );
  }

  const url = data?.url ?? "";

  if (isText && url) {
    return <TextEditor file={file} url={url} startEditing={startEditing} />;
  }

  if (cat === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed
      // URL on a third-party origin; the Next image optimiser cannot fetch it.
      <img
        src={url}
        alt={file.originalFilename}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    );
  }

  if (cat === "video") {
    return (
      /*
        preload="auto" because opening the preview *is* the intent to watch.
        "metadata" reads the header, then stops and waits for a click on play — so the
        buffering everyone waits through only begins after that click. Starting it when
        the player appears spends the same bytes a moment earlier, on a file the person
        has already chosen. Still ranged, so it is a buffer and not a download.

        It does not fix a slow start on its own. A GoPro MP4 puts its `moov` index at
        the end of the file, so the browser must reach past the whole thing before it
        can decode a frame, whatever it preloads.
      */
      <video className="max-h-full max-w-full rounded-lg" controls preload="auto" playsInline src={url}>
        Your browser does not support video playback.
      </video>
    );
  }

  if (cat === "audio") {
    return (
      <div className="w-full max-w-md rounded-lg bg-white/5 p-8 text-center text-white">
        <CategoryThumb category="audio" className="mx-auto mb-4" />
        <p className="text-sm font-medium">{file.originalFilename}</p>
        <audio className="mt-6 w-full" controls preload="metadata" src={url} />
      </div>
    );
  }

  if (cat === "pdf") {
    return (
      <iframe
        src={url}
        title={file.originalFilename}
        className="h-full w-full rounded-lg bg-white"
        /*
         * No sandbox here, unlike the HTML preview.
         *
         * This points at storage's own origin, so the same-origin policy already
         * keeps it away from this page — a sandbox adds nothing. What it did do was
         * disable the browser's built-in PDF viewer, which needs scripting, so the
         * frame came up empty.
         *
         * The HTML preview is the opposite case: it uses srcDoc, which inherits this
         * origin, so its sandbox is load-bearing and stays.
         */
      />
    );
  }

  return (
    <div className="flex flex-col items-center justify-center text-center text-white/70">
      <CategoryThumb category={cat} className="mb-4" />
      <p className="text-sm font-medium">{file.originalFilename}</p>
      <p className="mt-1 text-xs text-white/50">{formatBytes(file.sizeBytes)}</p>
      <p className="mt-3 text-xs">Preview is not available for this file type.</p>
    </div>
  );
}
