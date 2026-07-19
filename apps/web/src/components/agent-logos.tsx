import { AGENT_MARKS, AgentMark, type AgentMarkData } from "@/components/agent-marks";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * "Available for these agents" — an auto-scrolling, monochrome logo row that
 * pauses on hover. Each mark is a button: clicking it jumps to the "Connect
 * your agent" block and selects that agent, so the row is proof, not decoration.
 * Reduced motion stops the scroll and wraps the marks into a grid.
 */

function AgentIcon({
  agent,
  duplicate,
  onPick,
}: {
  agent: AgentMarkData;
  duplicate: boolean;
  onPick?: (name: string) => void;
}) {
  return (
    <li className={cn("px-6", duplicate && "marquee-dup")} aria-hidden={duplicate || undefined}>
      <Tooltip>
        <TooltipTrigger
          tabIndex={duplicate ? -1 : 0}
          aria-label={duplicate ? undefined : `Connect ${agent.name}`}
          onClick={() => onPick?.(agent.name)}
          className="flex size-6 items-center justify-center text-foreground/65 transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <AgentMark data={agent} />
        </TooltipTrigger>
        <TooltipContent>{agent.name}</TooltipContent>
      </Tooltip>
    </li>
  );
}

export function AgentLogos({ onPick }: { onPick?: (name: string) => void }) {
  return (
    <section aria-label="Available for these agents" className="border-y border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-7 px-1 py-12">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Available for these agents
        </p>
        <div className="marquee-mask relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
          <ul className="marquee-track flex w-max items-center">
            {[0, 1].map((copy) =>
              AGENT_MARKS.map((agent) => (
                <AgentIcon
                  key={`${copy}-${agent.name}`}
                  agent={agent}
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
