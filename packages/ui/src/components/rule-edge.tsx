import { cn } from "..";

/**
 * A panel edge that catches light — a 1px frame whose brightness falls off from
 * the top, so a flat surface reads as a physical panel without gaining a
 * shadow, a fill, or a hue. The gradient is clipped to the border by
 * `mask-composite: exclude` (see `.rule-gradient` in styles.css).
 *
 * It renders as its own overlay rather than as a border on the panel because
 * `mask` composites an element together with its descendants: applying the
 * class directly to a card would mask the card's own content away. The parent
 * needs `relative`; this sits on top at `inset-0` and never takes pointer
 * events, so it cannot interfere with anything it frames.
 *
 * Always decorative — the panel it frames must still carry its own semantics.
 * Where `mask-composite` is unsupported this degrades to the flat hairline.
 */
export function RuleEdge({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("rule-gradient pointer-events-none absolute inset-0 z-10", className)}
    />
  );
}
