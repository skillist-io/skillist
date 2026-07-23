import { cn } from "..";

/**
 * The Skillist wordmark: SKILLIST in the system's equipment-label voice —
 * Inter at 600, uppercase, +0.14em tracking. The logo is the same voice the
 * product labels its switches and readouts with, one step larger.
 *
 * Matches the generated assets (docs `logo-light.svg` / `logo-dark.svg`, the
 * brand pack, the OG card), which carry these letterforms as outlines cut from
 * the same Inter Variable the apps self-host. Uppercase comes from CSS so
 * assistive tech still reads the name as the word "Skillist", not initials.
 */
export function SkillistLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-semibold uppercase tracking-[0.14em] text-[1.0625rem] leading-none text-foreground",
        className,
      )}
    >
      Skillist
    </span>
  );
}
