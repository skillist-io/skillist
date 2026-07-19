import { Button, cn } from "@skillist/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Compact `‹ n / N ›` cycler shown under an assistant reply that has
 * regenerated variants. Stateless — the index is owned by the chat surface.
 * Hides itself when there's a single variant. Machine value → mono, tabular.
 */
export function BranchSelector({
  index,
  total,
  onPrev,
  onNext,
  className,
}: {
  /** Zero-based current index. */
  index: number;
  /** Total variants; the control hides itself when ≤ 1. */
  total: number;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}) {
  if (total <= 1) return null;
  return (
    <div className={cn("flex items-center gap-0.5 text-muted-foreground", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onPrev}
        disabled={index <= 0}
        aria-label="Previous response"
        className="size-6"
      >
        <ChevronLeft className="size-3.5" aria-hidden />
      </Button>
      <span className="font-mono text-[0.6875rem] tabular-nums">
        {index + 1} / {total}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onNext}
        disabled={index >= total - 1}
        aria-label="Next response"
        className="size-6"
      >
        <ChevronRight className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}
