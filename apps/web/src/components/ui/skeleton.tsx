import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse bg-muted motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Skeleton };
