import { useEffect, useState } from "react";

const AGENTS = ["Cursor", "Claude Code", "VS Code", "MCP"] as const;

const EVENTS = [
  { skill: "skillist/web-perf-audit", version: "v2.4.0", ms: 6 },
  { skill: "skillist/security-audit", version: "v1.8.2", ms: 4 },
  { skill: "skillist/cloudflare-deploy", version: "v3.1.0", ms: 8 },
  { skill: "skillist/registry-mcp", version: "v1.0.4", ms: 3 },
  { skill: "skillist/roll-dice", version: "v0.2.0", ms: 5 },
] as const;

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" className="size-3 text-signal" fill="none" aria-hidden>
      <path
        d="M2.5 6.2 4.8 8.5 9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
    <div className="w-full max-w-md border border-border bg-background text-left" aria-hidden>
      {/* Header — instrument label + live indicator, endpoint on the right. */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-2 text-[0.65rem] font-semibold tracking-widest text-signal uppercase">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping bg-signal opacity-75 motion-reduce:hidden" />
            <span className="relative inline-flex size-1.5 bg-signal" />
          </span>
          Publish fan-out
        </span>
        <span className="font-mono text-[0.65rem] text-muted-foreground">api.skillist.io</span>
      </div>

      <div className="px-4 py-4">
        {/* Skill id + version */}
        <div className="flex items-baseline justify-between gap-2">
          <span
            key={`${event.skill}-id`}
            className="truncate font-mono text-sm text-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
          >
            {event.skill}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{event.version}</span>
        </div>

        {/* Fan-out progress — the propagation itself, drawn as a filling bar. */}
        <div className="mt-3 h-1 w-full overflow-hidden bg-muted">
          <div
            key={`${event.skill}-bar`}
            className="h-full origin-left bg-signal motion-safe:animate-[fanout-grow_600ms_cubic-bezier(0.16,1,0.3,1)] motion-reduce:scale-x-100"
          />
        </div>

        {/* Targets — each edge that received the publish. */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
          {AGENTS.map((agent, i) => (
            <div
              key={`${event.skill}-${agent}`}
              style={{ animationDelay: `${120 + i * 90}ms` }}
              className="flex items-center gap-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:fill-mode-both"
            >
              <CheckIcon />
              <span className="truncate text-xs font-medium text-foreground">{agent}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer readout — reached count + total latency, the headline number. */}
      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        <span className="text-[0.65rem] font-semibold tracking-widest text-muted-foreground uppercase">
          Reached {AGENTS.length} agents
        </span>
        <span className="flex items-baseline gap-1">
          <span
            key={`${event.skill}-ms`}
            className="font-mono text-lg leading-none font-semibold text-foreground tabular-nums motion-safe:animate-in motion-safe:fade-in-0"
          >
            {event.ms}
          </span>
          <span className="font-mono text-[0.65rem] text-muted-foreground">ms</span>
        </span>
      </div>
    </div>
  );
}
