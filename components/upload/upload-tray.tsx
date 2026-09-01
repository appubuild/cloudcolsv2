"use client";

import { ChevronDown, ChevronUp, X, RotateCcw, ArrowUp, CheckCircle2, AlertCircle } from "lucide-react";
import { useUploadStore } from "@/lib/store/upload";
import { formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export function UploadTray() {
  const { open, setOpen, tasks } = useUploadStore();
  const remove = useUploadStore((s) => s.remove);
  const cancel = useUploadStore((s) => s.cancel);
  const retry = useUploadStore((s) => s.retry);
  const clearCompleted = useUploadStore((s) => s.clearCompleted);

  if (!open && tasks.length === 0) return null;
  const activeCount = tasks.filter((t) => t.status === "uploading" || t.status === "queued").length;

  return (
    <div className="fixed bottom-0 right-0 z-40 w-full sm:w-96">
      <div className="m-0 sm:m-4 rounded-t-lg sm:rounded-lg border border-border bg-surface shadow-elevated">
        {/* Header */}
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-3.5 py-2.5 text-sm font-semibold text-foreground"
        >
          <span className="flex items-center gap-2">
            Uploads
            {activeCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {activeCount} active
              </span>
            )}
          </span>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
        </button>

        {open && (
          <div className="max-h-72 overflow-auto border-t border-border">
            {tasks.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No uploads yet.</p>
            )}
            {tasks.map((t) => (
              <div key={t.id} className="border-b border-border px-3.5 py-2.5 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{t.filename}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(t.sizeBytes)}</span>
                    </div>
                    {t.status === "uploading" && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <Progress value={t.progress} className="flex-1" />
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {Math.round(t.progress)}%
                        </span>
                      </div>
                    )}
                    {t.status === "success" && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Done
                      </div>
                    )}
                    {t.status === "error" && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-error">
                        <AlertCircle className="h-3.5 w-3.5" /> {t.errorMessage}
                      </div>
                    )}
                    {(t.status === "queued" || t.status === "cancelled") && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t.status === "queued" ? "Waiting…" : "Cancelled"}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {(t.status === "uploading" || t.status === "queued") && (
                      <button onClick={() => cancel(t.id)} aria-label="Cancel upload" className="rounded p-1 text-muted-foreground hover:bg-surface-2">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {t.status === "error" && (
                      <button onClick={() => retry(t.id)} aria-label="Retry upload" className="rounded p-1 text-muted-foreground hover:bg-surface-2">
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    )}
                    <button onClick={() => remove(t.id)} aria-label="Remove from list" className="rounded p-1 text-muted-foreground hover:bg-surface-2">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {t.status === "uploading" && (
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <ArrowUp className="h-3 w-3" />
                      {formatBytes(t.speedBytesPerSec)}/s
                    </span>
                    <span>
                      ~{Math.max(1, Math.abs(t.sizeBytes / Math.max(1, t.speedBytesPerSec))) | 0}s left
                    </span>
                  </div>
                )}
              </div>
            ))}
            {tasks.some((t) => ["success", "cancelled", "error"].includes(t.status)) && (
              <div className="flex justify-center border-t border-border p-2">
                <Button variant="ghost" size="sm" onClick={clearCompleted}>
                  Clear finished
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
