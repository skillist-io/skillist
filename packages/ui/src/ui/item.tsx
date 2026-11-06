import type * as React from "react";
import { cn } from "../utils";

/**
 * A bordered row for one thing that needs a person's attention.
 *
 * Adapted from the shadcn/ui `item` source (MIT, radix-sera style), keeping only
 * the parts in use. Upstream's title is uppercase and clamped, and its description
 * clamps to two lines. Both are removed: this carries the text someone is about
 * to approve, and truncating that at the moment of decision is the failure it
 * exists to prevent.
 */
function Item({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item"
      className={cn(
        "flex w-full flex-wrap items-start gap-3 border border-border px-3.5 py-3 text-sm",
        className,
      )}
      {...props}
    />
  );
}

function ItemMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-media"
      className={cn(
        "flex shrink-0 translate-y-0.5 items-center justify-center [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-1", className)}
      {...props}
    />
  );
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn("text-sm leading-snug font-medium wrap-break-word", className)}
      {...props}
    />
  );
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

function ItemFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-footer"
      className={cn("flex basis-full flex-wrap items-center justify-between gap-2", className)}
      {...props}
    />
  );
}

export { Item, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle };
