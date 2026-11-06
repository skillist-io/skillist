import type * as React from "react";
import { cn } from "../utils";
import { Textarea } from "./textarea";

/**
 * A field with attached controls, sharing one underline and one focus state.
 *
 * Adapted from the shadcn/ui `input-group` source (MIT, radix-sera style), keeping
 * the block layout the agent composer uses. Upstream's addon only forwards a click
 * to an `input`, so a click beside a textarea did nothing; this forwards to either.
 */
function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group flex w-full min-w-0 flex-col border-b border-b-input-line transition-[border-color,box-shadow] outline-none",
        "has-[[data-slot=input-group-control]:focus-visible]:border-b-ring has-[[data-slot=input-group-control]:focus-visible]:shadow-[0_1px_0_0_var(--ring)]",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupAddon({
  className,
  align = "block-end",
  onClick,
  ...props
}: React.ComponentProps<"div"> & { align?: "block-start" | "block-end" }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer convenience; the control is reachable by keyboard
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn(
        "flex w-full min-w-0 cursor-text items-center gap-2 text-xs text-muted-foreground",
        align === "block-start" ? "order-first pb-1" : "order-last pb-2",
        className,
      )}
      onClick={(e) => {
        onClick?.(e);
        if ((e.target as HTMLElement).closest("button, a")) return;
        e.currentTarget.parentElement
          ?.querySelector<HTMLElement>("[data-slot=input-group-control]")
          ?.focus();
      }}
      {...props}
    />
  );
}

function InputGroupTextarea({ className, ...props }: React.ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn("flex-1 border-0 py-2 focus-visible:shadow-none", className)}
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupTextarea };
