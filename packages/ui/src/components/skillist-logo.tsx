import { cn } from "..";

/**
 * The socket: Skillist's mark for square contexts and, paired with the wordmark,
 * the horizontal lockup. Four congruent L corner-tiles framing an empty centre
 * — the tiles are the registry, the socket is the slot the next skill drops
 * into. Single ink (currentColor), squared, transparent seams + centre so it
 * inverts with whatever it sits on.
 *
 * Geometry mirrors socketTiles(48) in scripts/brand/geometry.mjs; the generated
 * favicon and brand-pack assets are drawn from that same source. Keep the two in
 * sync — never hand-tune one without the other. Below ~28px the seams smear, so
 * small standalone uses (favicons, tiny icons) take the generated aperture, not
 * this component.
 */
export function SkillistMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-6", className)}
    >
      <rect x="6.72" y="6.72" width="16.42" height="10.8" />
      <rect x="6.72" y="6.72" width="10.8" height="16.42" />
      <rect x="24.86" y="6.72" width="16.42" height="10.8" />
      <rect x="30.48" y="6.72" width="10.8" height="16.42" />
      <rect x="24.86" y="30.48" width="16.42" height="10.8" />
      <rect x="30.48" y="24.86" width="10.8" height="16.42" />
      <rect x="6.72" y="30.48" width="16.42" height="10.8" />
      <rect x="6.72" y="24.86" width="10.8" height="16.42" />
    </svg>
  );
}

/**
 * The Skillist wordmark: SKILLIST in the system's equipment-label voice —
 * Inter at 600, uppercase, +0.14em tracking. The logo is the same voice the
 * product labels its switches and readouts with, one step larger.
 *
 * Matches the generated assets (docs `logo-light.svg` / `logo-dark.svg`, the
 * brand pack, the OG card), which carry these letterforms as outlines cut from
 * the same Inter Variable the apps self-host. Uppercase comes from CSS so
 * assistive tech still reads the name as the word "Skillist", not initials.
 *
 * `withMark` prepends the socket for the horizontal lockup used in the site
 * header and footer; without it the wordmark stands alone (nav rails and other
 * tight spots where the mark already appears elsewhere).
 */
export function SkillistLogo({
  className,
  withMark = false,
}: {
  className?: string;
  withMark?: boolean;
}) {
  const word = (
    <span
      className={cn(
        "font-semibold uppercase tracking-[0.14em] text-[1.0625rem] leading-none text-foreground",
        !withMark && className,
      )}
    >
      Skillist
    </span>
  );

  if (!withMark) return word;

  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      {/* Sized a touch taller than the wordmark's cap height so the mark reads
          as the anchor of the lockup rather than a bullet before the word. */}
      <SkillistMark className="size-[1.375rem]" />
      {word}
    </span>
  );
}
