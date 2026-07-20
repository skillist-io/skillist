import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Our design tokens add custom font-size utilities (`text-hero/display/headline/title`,
// DESIGN.md §3). tailwind-merge doesn't know these are font sizes, so by default
// it classifies them as text-color and drops them when a color like
// `text-foreground` is also present — silently downgrading every PageTitle /
// SectionTitle to body size. Registering them in the font-size group fixes it.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["hero", "display", "headline", "title"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Compact human count: 1240 -> "1.2k", 18420 -> "18k", 1_500_000 -> "1.5M". */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
