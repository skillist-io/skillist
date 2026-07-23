import {
  Button,
  consoleUrl,
  RuleEdge,
  SignalField,
  signalFieldClass,
  TooltipProvider,
  useSession,
} from "@skillist/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { AgentConnect } from "@/components/agent-connect";
import { AgentLogos } from "@/components/agent-logos";
import { RealtimeFanout } from "@/components/realtime-fanout";
import { RegistryFeatured } from "@/components/registry-featured";
import { RegistryTrending } from "@/components/registry-trending";

export const Route = createFileRoute("/")({
  component: HomePage,
});

const CAPABILITIES: { title: string; desc: string; preview: ReactNode }[] = [
  {
    title: "Hosted execution",
    desc: "Run skill scripts in isolated sandboxes with streaming output, quotas, and per-run access control.",
    preview: (
      <>
        <span aria-hidden className="inline-flex size-1.5 shrink-0 bg-signal" />
        <span className="text-foreground">skillist run</span>
        <span className="truncate">web-perf-audit</span>
        <span className="ml-auto shrink-0 text-muted-foreground/70">exit 0</span>
      </>
    ),
  },
  {
    title: "Evals & observability",
    desc: "Measure skill uplift, track regression across versions, and watch every run as it happens.",
    preview: (
      <>
        <span className="text-foreground">uplift</span>
        <span>+11.4%</span>
        <span aria-hidden className="ml-auto flex items-end gap-0.5">
          {[4, 7, 5, 9, 6, 11].map((h) => (
            <span key={h} className="w-1 bg-muted-foreground/45" style={{ height: `${h}px` }} />
          ))}
        </span>
      </>
    ),
  },
  {
    title: "Registry discovery",
    desc: "Search by tag, agent, and runtime. Install from the CLI, an MCP client, or the apex URL.",
    preview: (
      <>
        <span>tag:security</span>
        <span className="text-muted-foreground/40">·</span>
        <span>agent:claude</span>
        <span className="text-muted-foreground/40">·</span>
        <span>runtime:node</span>
      </>
    ),
  },
  {
    title: "Coverage",
    desc: "See required skills move from published to covered to activated across your repos, with a drift list of what is required but not installed.",
    preview: (
      <>
        <span>published</span>
        <span className="text-muted-foreground/40">→</span>
        <span>covered</span>
        <span className="text-muted-foreground/40">→</span>
        <span className="text-foreground">activated</span>
        <span className="ml-auto shrink-0 text-muted-foreground/70">2 in drift</span>
      </>
    ),
  },
  {
    title: "Self-improving skills",
    desc: "Skillist clusters recurring run failures and weak evals, then drafts concrete fixes you approve before they ship as a new version.",
    preview: (
      <>
        <span>failures clustered</span>
        <span className="text-muted-foreground/40">→</span>
        <span className="text-foreground">draft fix</span>
        <span className="ml-auto shrink-0 text-muted-foreground/70">needs review</span>
      </>
    ),
  },
  {
    title: "Platform agent",
    desc: "A conversational agent that inspects coverage, surfaces recurring failures, recommends required skills, and drafts improvements for your org.",
    preview: (
      <>
        <span aria-hidden className="shrink-0 text-muted-foreground/70">
          ›
        </span>
        <span className="text-foreground">agent</span>
        <span className="truncate">what is required but missing?</span>
      </>
    ),
  },
];

function HomePage() {
  const { data: session } = useSession();
  const [agent, setAgent] = useState("Claude Code");
  const connectRef = useRef<HTMLDivElement>(null);

  function pickAgent(name: string) {
    setAgent(name);
    connectRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col">
        {/* Hero — two-column composure. Text carries the left axis, the live
            fan-out readout anchors the right. Capped display per DESIGN.md.

            The `dark` class is the Dark Hero Exception (DESIGN.md §2): this one
            band renders on the near-black ground in BOTH themes. `.dark` sets
            the token custom properties on this element, so everything inside —
            including <SignalField>, which samples `--signal` from its own
            position in the DOM — resolves against the dark palette without any
            component needing to know it is in a hero. The band is bounded: it
            closes on a hairline and the page below returns to the page's own
            surface. No fade, because a dark-to-white ramp in the light theme is
            exactly the gradient hero the system rejects. */}
        {/* `-mx-4 -mt-8 md:-mx-6` cancels the padding <main> applies, so the band
            reaches the viewport edge and starts flush under the header. Done
            here rather than by unpadding <main>, because /registry and the
            public skill pages are fluid too and depend on that padding.

            The inner wrapper then re-applies main's own `px-4 md:px-6`. It has
            to be a separate element rather than extra padding on the centred
            box: a max-w-6xl box centred inside a symmetrically padded parent
            lands at the same absolute x as one centred in the bare viewport, so
            padding folded into the centred box does not restore the inset, it
            just pushes the content 24px further in than every section below. */}
        <section className="dark panel-noise relative -mx-4 -mt-8 overflow-hidden border-b border-border bg-background text-foreground md:-mx-6">
          {/* The ruled grid, but live — publish packets travel it. Same texture
              and fade as the dashboard's <CanvasBackdrop>, so the marketing and
              product surfaces still read as one instrument. */}
          <SignalField className={signalFieldClass} />
          <div className="px-4 md:px-6">
            <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-1 py-20 md:py-28 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="flex flex-col items-start gap-6">
                <span className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                  <span className="relative flex size-1.5 items-center justify-center">
                    <span className="absolute inline-flex size-1.5 animate-ping bg-signal opacity-60 motion-reduce:hidden" />
                    <span className="inline-flex size-1.5 bg-signal" />
                  </span>
                  Live registry · sub-10ms fan-out
                </span>
                {/* `text-hero` is the sanctioned marketing display step — it carries
                  its own weight, tracking, and line-height (see styles.css), so this
                  no longer hand-rolls a clamp that silently outgrew the token scale. */}
                <h1 className="text-balance text-hero text-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
                  The realtime registry{" "}
                  <span className="text-muted-foreground">for Agent Skills</span>
                </h1>
                <p className="max-w-xl text-lg leading-relaxed text-muted-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:delay-100 motion-safe:fill-mode-both">
                  Publish, version, govern, and deliver SKILL.md bundles that run and improve
                  themselves. Works with Claude Code, Cursor, VS Code, Gemini, Codex, and any{" "}
                  {/* Hover strengthens the rule rather than changing the ink. The
                    old `hover:text-signal` spent live/realtime violet on a
                    decorative hover, which the ≤10% budget reserves for state. */}
                  <a
                    href="https://agentskills.io/home"
                    className="text-foreground underline decoration-foreground/40 underline-offset-4 transition-colors duration-200 hover:decoration-foreground"
                  >
                    agentskills.io
                  </a>{" "}
                  client.
                </p>
                <div className="flex flex-wrap gap-3 pt-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:delay-200 motion-safe:fill-mode-both">
                  <Button size="lg" asChild>
                    <Link to="/registry">Browse registry</Link>
                  </Button>
                  {session?.user ? (
                    <Button size="lg" variant="outline" asChild>
                      <a href={consoleUrl("/dashboard")}>Open dashboard</a>
                    </Button>
                  ) : (
                    <Button size="lg" variant="outline" asChild>
                      <a href={consoleUrl("/login")}>Start publishing</a>
                    </Button>
                  )}
                </div>
              </div>
              <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:delay-300 motion-safe:fill-mode-both">
                <RealtimeFanout />
              </div>
            </div>
          </div>

          {/* The logo wall sits inside the band, over a hairline, rather than
              after it. It is evidence for the claim the headline just made, so
              it belongs to the hero rather than starting the page's next idea.
              The rule runs the full width of the band; only its contents are
              held to main's inset. */}
          <div className="relative border-t border-border">
            <div className="px-4 md:px-6">
              <AgentLogos onPick={pickAgent} className="" />
            </div>
          </div>
        </section>

        {/* Capabilities — ruled columns, not a card grid. Numbered like a spec
            sheet, each cell closing on a small mono instrument readout. */}
        <section className="mx-auto w-full max-w-6xl px-1 py-16">
          {/* The `bg-border` + `gap-px` trick draws the internal rules; RuleEdge
              supplies the outer frame so the grid reads as one milled panel. */}
          <div className="relative grid gap-px bg-border sm:grid-cols-3">
            <RuleEdge />
            {CAPABILITIES.map((c, i) => (
              <div key={c.title} className="flex flex-col gap-4 bg-background p-6">
                <span className="font-mono text-xs text-muted-foreground">{`0${i + 1}`}</span>
                <div className="flex flex-col gap-2">
                  <h2 className="text-headline text-foreground">{c.title}</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">{c.desc}</p>
                </div>
                <div className="mt-auto flex items-center gap-2 border-t border-border pt-4 font-mono text-xs text-muted-foreground">
                  {c.preview}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Connect — proof behind the logo row: real per-agent setup. */}
        <div ref={connectRef} id="connect" className="scroll-mt-16 border-t border-border">
          <AgentConnect selected={agent} onSelect={setAgent} />
        </div>

        {/* Featured */}
        <section className="mx-auto w-full max-w-6xl px-1 py-16">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-headline text-foreground">Featured skills</h2>
              <p className="text-sm text-muted-foreground">
                Curated picks to get started. Install with one command.
              </p>
            </div>
          </div>
          <RegistryFeatured />
        </section>

        {/* Trending */}
        <section className="mx-auto w-full max-w-6xl px-1 pb-20">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-headline text-foreground">Trending this week</h2>
              <p className="text-sm text-muted-foreground">Most installed across the registry.</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/registry">View all</Link>
            </Button>
          </div>
          <RegistryTrending />
        </section>
      </div>
    </TooltipProvider>
  );
}
