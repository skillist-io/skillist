import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AgentConnect } from "@/components/agent-connect";
import { AgentLogos } from "@/components/agent-logos";
import { RealtimeFanout } from "@/components/realtime-fanout";
import { RegistryFeatured } from "@/components/registry-featured";
import { RegistryTrending } from "@/components/registry-trending";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/")({
  component: HomePage,
});

const CAPABILITIES = [
  {
    title: "Hosted execution",
    desc: "Run skill scripts in isolated sandboxes with streaming output, quotas, and per-run access control.",
  },
  {
    title: "Evals & observability",
    desc: "Measure skill uplift, track regression across versions, and watch every run as it happens.",
  },
  {
    title: "Registry discovery",
    desc: "Search by tag, agent, and runtime. Install from the CLI, an MCP client, or the apex URL.",
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
            fan-out readout anchors the right. Capped display per DESIGN.md. */}
        <section className="relative overflow-hidden border-b border-border">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(120%_100%_at_15%_0%,black,transparent_70%)]"
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
              backgroundSize: "64px 64px",
            }}
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-1 py-16 md:py-24 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="flex flex-col items-start gap-6">
              <span className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                <span className="relative flex size-1.5 items-center justify-center">
                  <span className="absolute inline-flex size-1.5 animate-ping bg-signal opacity-60 motion-reduce:hidden" />
                  <span className="inline-flex size-1.5 bg-signal" />
                </span>
                Live registry · sub-10ms fan-out
              </span>
              <h1 className="text-balance font-bold text-[clamp(2.5rem,5.5vw,4rem)] leading-[1.02] tracking-[-0.03em] text-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
                The realtime registry for Agent Skills
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-muted-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:delay-100 motion-safe:fill-mode-both">
                Publish, version, govern, and deliver SKILL.md bundles that run and improve
                themselves. Works with Cursor, Claude Code, VS Code, and any{" "}
                <a
                  href="https://agentskills.io/home"
                  className="text-foreground underline underline-offset-4 hover:text-signal"
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
                    <Link to="/dashboard">Open dashboard</Link>
                  </Button>
                ) : (
                  <Button size="lg" variant="outline" asChild>
                    <Link to="/login" search={{ redirect: undefined }}>
                      Start publishing
                    </Link>
                  </Button>
                )}
              </div>
            </div>
            <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:delay-300 motion-safe:fill-mode-both">
              <RealtimeFanout />
            </div>
          </div>
        </section>

        <AgentLogos onPick={pickAgent} />

        {/* Capabilities — ruled columns, not a card grid. Hairline dividers
            carry the structure the way rules do on a spec sheet. */}
        <section className="mx-auto w-full max-w-6xl px-1 py-16">
          <div className="grid gap-px border border-border bg-border sm:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className="flex flex-col gap-2 bg-background p-6">
                <h2 className="text-headline text-foreground">{c.title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{c.desc}</p>
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
