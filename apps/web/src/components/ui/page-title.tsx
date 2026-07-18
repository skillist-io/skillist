import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type HeadingElement = "h1" | "h2" | "h3";

interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Override the rendered element to keep the document outline correct. */
  as?: HeadingElement;
}

/**
 * Page / hero heading on the Display scale (DESIGN.md §3). Renders `<h1>` by
 * default; pass `as` for pages where the Display headline is not the top-level
 * heading. `text-display` carries weight 700, -0.02em tracking, and 1.05
 * line-height from the theme; `text-balance` keeps ragged lines even.
 */
export function PageTitle({ as: Tag = "h1", className, ...props }: HeadingProps) {
  return <Tag className={cn("text-display text-balance text-foreground", className)} {...props} />;
}

/**
 * Section / card heading on the Headline scale (DESIGN.md §3). Renders `<h2>`
 * by default. `text-headline` carries weight 600 and -0.01em tracking.
 */
export function SectionTitle({ as: Tag = "h2", className, ...props }: HeadingProps) {
  return <Tag className={cn("text-headline text-balance text-foreground", className)} {...props} />;
}
