import { cn } from "..";

/**
 * The shared "canvas" texture — a 64px hairline grid on the base surface, the
 * ruled-panel look borrowed from Neon / Better Auth but kept theme-aware and
 * color-free so it passes WCAG in light and dark (no gradient hero, per
 * DESIGN.md). One source of truth so the marketing hero and the product
 * dashboard read as the same instrument surface. Callers set opacity + a mask
 * to control how far the grid fades.
 *
 * Always decorative: `aria-hidden`, non-interactive, and it sits behind content
 * (give the parent `relative` and lift content with `relative z-10`).
 */

/**
 * The canonical intensity + fade for the grid, so the homepage hero and the
 * dashboard render the *same* crosshatch. Use this on both; the dashboard just
 * adds `-z-10` for layering. Change it here and both move together.
 */
export const canvasBackdropClass =
  "opacity-60 [mask-image:radial-gradient(120%_100%_at_15%_0%,black,transparent_70%)]";

export function CanvasBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{
        backgroundImage:
          "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
        backgroundSize: "64px 64px",
      }}
    />
  );
}
