"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Spinner } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";

/**
 * The video preview.
 *
 * A real `<video controls>` underneath, deliberately. The browser's own controls
 * already give seeking, volume, mute, fullscreen, picture-in-picture, the time
 * readout, a progress bar, touch handling that works on a phone, and captions support
 * — and every one of those is better than a reimplementation, on every platform, for
 * free. What is added here is only what the element does not do: saying that it is
 * still opening, saying when it has failed, and offering to try again.
 *
 * Playback is ranged. `preload="auto"` starts buffering as soon as the preview opens,
 * because opening it *is* the intent to watch, and the browser then fetches only the
 * ranges it needs. A three-gigabyte file starts without being downloaded.
 */
export function VideoPlayer({
  src,
  poster,
  filename,
  durationSeconds,
  width,
  height,
  onRetry,
}: {
  src: string;
  poster?: string;
  filename: string;
  /** Known from upload, so the space can be reserved before anything loads. */
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  onRetry?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  // A new source is a new load, whatever happened to the last one.
  useEffect(() => {
    setState("loading");
  }, [src, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
    onRetry?.();
    // `load()` on the same element rather than a remount: it drops the failed state
    // and starts again without the browser re-resolving anything it already has.
    ref.current?.load();
  }, [onRetry]);

  /**
   * The shortcuts people expect from a video.
   *
   * Handled on the wrapper, and only while the element itself is not focused — when it
   * is, the browser's own controls already do all of this, and doing it twice seeks
   * ten seconds for one key press.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const video = ref.current;
      if (!video || document.activeElement === video) return;

      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          if (video.paused) void video.play().catch(() => {});
          else video.pause();
          break;
        case "ArrowRight":
          e.preventDefault();
          video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
          break;
        case "ArrowLeft":
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          break;
        case "ArrowUp":
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          break;
        case "m":
          e.preventDefault();
          video.muted = !video.muted;
          break;
        case "f":
          e.preventDefault();
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          else void video.requestFullscreen?.().catch(() => {});
          break;
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (state === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 text-center text-white/80">
        <AlertCircle className="h-8 w-8 text-error" />
        <p className="text-sm font-medium">{filename}</p>
        <p className="max-w-sm text-xs text-white/60">
          This video could not be played. The link may have expired, the connection may
          have dropped, or this browser may not support the format.
        </p>
        <Button size="sm" variant="secondary" onClick={retry}>
          <RotateCcw className="h-4 w-4" /> Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex max-h-full max-w-full items-center justify-center">
      <video
        key={attempt}
        ref={ref}
        className="max-h-full max-w-full rounded-lg"
        controls
        // The bytes are wanted: opening a preview is the intent to watch. Still ranged,
        // so this is a buffer rather than a download.
        preload="auto"
        playsInline
        poster={poster}
        src={src}
        // Reserving the right shape stops the dialog resizing under the pointer the
        // moment metadata arrives. Known from upload; absent for older files.
        width={width ?? undefined}
        height={height ?? undefined}
        onLoadedData={() => setState("ready")}
        onCanPlay={() => setState("ready")}
        onPlaying={() => setState("ready")}
        onError={() => setState("error")}
      >
        Your browser does not support embedded video.
      </video>

      {state === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
          {/* Over the poster, which is already showing the real first frame, so this
              is a sign of progress rather than a blank screen with a spinner on it. */}
          <Spinner className="h-8 w-8" />
          {durationSeconds ? (
            <span className="rounded bg-black/50 px-2 py-0.5 text-[11px] text-white/80">
              {formatDuration(durationSeconds)}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** m:ss, or h:mm:ss once it is worth the extra field. */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
