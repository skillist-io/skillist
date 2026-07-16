import { cn } from "@/lib/utils";

/**
 * Squared, underline-styled native <select> matching the input vocabulary
 * (bottom border only, no box, no radius). Native on purpose: accessible and
 * familiar. Callers add width utilities (e.g. w-full) as needed.
 */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 border border-transparent border-b-input bg-transparent px-1 text-sm outline-none transition-[border-color] pointer-coarse:h-11 focus-visible:border-b-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
