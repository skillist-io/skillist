import { ChevronRightIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";

/**
 * One shape for every step an agent takes: a line that can open onto its detail.
 *
 * Adapted from the shadcn/ui AI Elements `trace` source (MIT, radix-sera style).
 * Three deliberate changes for DESIGN.md:
 *   - Lines are mono. They are the Machine Voice, kept apart from the agent's prose.
 *   - Live state is the signal accent. Upstream uses a `shimmer` utility we don't ship.
 *   - The open/close height animation is gone; those keyframes aren't in this system.
 */
function Trace({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="trace"
      className={cn("flex w-full min-w-0 flex-col gap-1.5", className)}
      {...props}
    />
  );
}

/** `attention` is ours: a step waiting on a person, which is neither activity nor failure. */
type TraceStatus = "running" | "error" | "attention";

function TraceLine({
  className,
  status,
  ...props
}: React.ComponentProps<"span"> & { status?: TraceStatus }) {
  return (
    <span
      data-slot="trace-line"
      data-status={status}
      className={cn(
        "flex w-fit max-w-full min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground transition-colors",
        "in-[button:hover]:text-foreground data-[status=attention]:text-signal data-[status=error]:text-destructive",
        "data-[status=error]:in-[button:hover]:text-destructive data-[status=running]:*:data-[slot=trace-icon]:text-signal",
        className,
      )}
      {...props}
    />
  );
}

function TraceIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-icon"
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

function TraceTitle({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="trace-title" className={cn("min-w-0 truncate", className)} {...props} />;
}

function TraceCollapsible({ className, ...props }: React.ComponentProps<typeof Collapsible>) {
  return (
    <Collapsible
      data-slot="trace-collapsible"
      className={cn("flex w-full min-w-0 flex-col", className)}
      {...props}
    />
  );
}

function TraceCollapsibleTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger
      data-slot="trace-collapsible-trigger"
      className={cn(
        "group/trace-trigger flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
      <TraceIcon className="text-muted-foreground transition-transform group-aria-expanded/trace-trigger:rotate-90 motion-reduce:transition-none">
        <ChevronRightIcon />
      </TraceIcon>
    </CollapsibleTrigger>
  );
}

function TraceCollapsibleContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent data-slot="trace-collapsible-content" className="min-w-0" {...props}>
      <div
        data-slot="trace-collapsible-content-inner"
        className={cn(
          "mt-2 mb-1 ml-[calc(--spacing(2)-1px)] flex min-w-0 flex-col gap-2 border-l border-border pl-4 text-xs wrap-break-word text-muted-foreground",
          className,
        )}
      >
        {children}
      </div>
    </CollapsibleContent>
  );
}

export {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
};
