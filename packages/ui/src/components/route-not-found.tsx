import { useRouter, useRouterState } from "@tanstack/react-router";
import { FileQuestion } from "lucide-react";
import { Button } from "..";
import { webUrl } from "../lib/urls";

/**
 * The 404, shared by the marketing site and the console.
 *
 * The tone is deliberately dry rather than playful: the system rejects
 * consumer-cute (DESIGN.md §1), so the joke is self-deprecating and told in the
 * product's own vocabulary — a lookup that failed to resolve, reported the way
 * any other failed lookup would be. It reads as an instrument admitting a miss,
 * not a mascot apologising.
 *
 * It also does the useful thing a 404 usually forgets: shows the path actually
 * requested, so a mistyped or truncated link is diagnosable rather than
 * mysterious.
 */
export function RouteNotFound() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const readout: [string, string][] = [
    ["Requested", pathname],
    ["Status", "404 · no match"],
    ["Registry", "searched"],
    ["Mirrors", "searched"],
  ];

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex size-10 items-center justify-center border border-border text-muted-foreground">
          <FileQuestion className="size-5" aria-hidden />
        </div>

        <p className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
          404 · Not found
        </p>
        <h1 className="mt-2 text-display text-foreground">Nothing resolves here</h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Every skill on Skillist runs and improves itself. This page managed neither.
        </p>

        {/* The readout doubles as the diagnosis: seeing the exact path is what
            turns "broken link" into "ah, it got truncated". */}
        <dl className="mt-8 border-t border-border">
          {readout.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-4 border-b border-border py-2.5">
              <dt className="w-24 shrink-0 text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
                {label}
              </dt>
              <dd className="m-0 min-w-0 truncate font-mono text-xs text-foreground">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 flex flex-wrap gap-2">
          <Button type="button" asChild>
            <a href={webUrl("/registry")}>Browse the registry</a>
          </Button>
          <Button type="button" variant="outline" onClick={() => void router.navigate({ to: "/" })}>
            Go home
          </Button>
        </div>
      </div>
    </div>
  );
}
