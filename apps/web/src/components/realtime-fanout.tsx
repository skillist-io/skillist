import { useEffect, useState } from "react";

const AGENTS = ["Cursor", "Claude Code", "VS Code", "MCP"] as const;

const EVENTS = [
  { skill: "skillist/web-perf-audit", version: "v2.4.0", ms: 6 },
  { skill: "skillist/security-audit", version: "v1.8.2", ms: 4 },
  { skill: "skillist/cloudflare-deploy", version: "v3.1.0", ms: 8 },
  { skill: "skillist/registry-mcp", version: "v1.0.4", ms: 3 },
  { skill: "skillist/roll-dice", version: "v0.2.0", ms: 5 },
] as const;

export function RealtimeFanout() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % EVENTS.length);
    }, 3200);
    return () => clearInterval(id);
  }, []);

  const event = EVENTS[index] ?? EVENTS[0];

  return (
    <div
      className="mx-auto w-full max-w-md border border-border bg-card text-left"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-2 text-[0.65rem] font-semibold tracking-widest text-signal uppercase">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-signal opacity-75 motion-reduce:hidden" />
            <span className="relative inline-flex size-1.5 rounded-full bg-signal" />
          </span>
          Publish fan-out
        </span>
        <span className="font-mono text-[0.65rem] text-muted-foreground">skillist.io</span>
      </div>
      <div className="space-y-3 px-4 py-4">
        <div
          key={event.skill}
          className="flex items-baseline justify-between gap-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
        >
          <span className="truncate font-mono text-sm text-foreground">{event.skill}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{event.version}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {AGENTS.map((agent, i) => (
            <span
              key={`${event.skill}-${agent}`}
              style={{ animationDelay: `${i * 70}ms` }}
              className="border border-signal/40 bg-signal/10 px-2 py-1 text-[0.625rem] font-semibold tracking-wide text-signal uppercase motion-safe:animate-in motion-safe:fade-in-0"
            >
              {agent}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-[0.65rem] font-semibold tracking-widest text-muted-foreground uppercase">
            Reached {AGENTS.length} agents
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">{event.ms}ms</span>
        </div>
      </div>
    </div>
  );
}
