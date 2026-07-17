import { cn } from "@/lib/utils";

/** Wordmark matching docs (`logo-light.svg` / `logo-dark.svg`). */
export function SkillistLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-bold tracking-[-0.04em] text-[1.375rem] leading-none text-foreground",
        className,
      )}
    >
      Skillist
    </span>
  );
}
