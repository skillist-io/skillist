import { cn } from "@skillist/ui";
import { AGENT_NAMES } from "@/components/agent-names";

/**
 * "Available for these agents" — an auto-scrolling, monochrome row that pauses
 * on hover. Each entry is a button: clicking it jumps to the "Connect your
 * agent" block and selects that agent, so the row is proof, not decoration.
 * Reduced motion stops the scroll and wraps the entries into a grid.
 *
 * Wordmarks, not logos: naming a client to state compatibility is nominative
 * use, while reproducing its logo needs permission we have not sought. The
 * component keeps its name because it is still the layout's logo-wall slot.
 */

function AgentWordmark({
  name,
  duplicate,
  onPick,
}: {
  name: string;
  duplicate: boolean;
  onPick?: (name: string) => void;
}) {
  return (
    <li className={cn("px-6", duplicate && "marquee-dup")} aria-hidden={duplicate || undefined}>
      <button
        type="button"
        tabIndex={duplicate ? -1 : 0}
        aria-label={duplicate ? undefined : `Connect ${name}`}
        onClick={() => onPick?.(name)}
        className="whitespace-nowrap text-sm font-medium text-foreground/65 transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {name}
      </button>
    </li>
  );
}

export function AgentLogos({
  onPick,
  className = "border-y border-border",
}: {
  onPick?: (name: string) => void;
  /** Border set by the caller: inside the hero band the top rule is enough,
      because the band's own bottom border already closes it. */
  className?: string;
}) {
  return (
    <section aria-label="Available for these agents" className={className}>
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-7 px-1 py-12">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Available for these agents
        </p>
        {/* Reduced motion wraps the track into a centred grid, so the row needs
            vertical breathing room it never needed as a single icon line. */}
        <div className="marquee-mask relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
          <ul className="marquee-track flex w-max items-center gap-y-3">
            {[0, 1].map((copy) =>
              AGENT_NAMES.map((name) => (
                <AgentWordmark
                  key={`${copy}-${name}`}
                  name={name}
                  duplicate={copy === 1}
                  onPick={onPick}
                />
              )),
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
