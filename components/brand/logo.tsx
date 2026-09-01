import { cn } from "@/lib/utils";
import { Cloud } from "lucide-react";

export function Logo({ className, size = 28, markOnly }: { className?: string; size?: number; markOnly?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className="inline-flex items-center justify-center rounded-md bg-primary text-primary-fg"
        style={{ width: size, height: size }}
      >
        <Cloud className="h-[60%] w-[60%]" strokeWidth={2.5} />
      </span>
      {!markOnly && (
        <span className="text-lg font-bold tracking-tight text-foreground">
          Cloud<span className="text-primary">Cols</span>
        </span>
      )}
    </span>
  );
}
