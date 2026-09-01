"use client";

import { useEffect, useState } from "react";
import { X, Download, Share2, Star, ExternalLink } from "lucide-react";
import type { File } from "@/lib/types";
import { filesRepo } from "@/lib/repositories";
import { useAuthStore } from "@/lib/store/auth";
import { Spinner, Badge } from "@/components/ui/misc";
import { CategoryThumb } from "@/components/files/category-thumb";
import { formatBytes } from "@/lib/utils";
import { toast } from "@/lib/store/toast";

export function PreviewPortal({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
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
            onClick={() => toast.info("Download started", file?.originalFilename)}
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
            onClick={() => toast.info("External open", "Opening in a new tab is available in the full app.")}
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
          <FileRenderer file={file} />
        )}
      </div>
    </div>
  );
}

function FileRenderer({ file }: { file: File }) {
  const cat = file.category;

  if (cat === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><rect width="200" height="120" fill="#1e293b"/><text x="100" y="64" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#94a3b8">${file.originalFilename}</text></svg>`)}`}
        alt={file.originalFilename}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    );
  }

  if (cat === "video") {
    return (
      <video
        className="max-h-full max-w-full rounded-lg"
        controls
        src={`data:video/mp4;base64,`}
      >
        Your browser does not support video playback.
      </video>
    );
  }

  if (cat === "audio") {
    return (
      <div className="w-full max-w-md rounded-lg bg-white/5 p-8 text-center text-white">
        <CategoryThumb category="audio" className="mx-auto mb-4" />
        <p className="text-sm font-medium">{file.originalFilename}</p>
        <audio className="mt-6 w-full" controls src={`data:audio/mpeg;base64,`} />
      </div>
    );
  }

  if (cat === "pdf") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center text-center text-white/70">
        <CategoryThumb category="pdf" className="mb-4" />
        <p className="text-sm">{file.originalFilename}</p>
        <Badge tone="muted" className="mt-3">PDF preview loads in the full app</Badge>
      </div>
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
