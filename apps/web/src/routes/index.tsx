import { createFileRoute, Link } from "@tanstack/react-router";
import { InstallSnippet } from "@/components/install-snippet";
import { RealtimeFanout } from "@/components/realtime-fanout";
import { RegistryFeatured } from "@/components/registry-featured";
import { RegistryTrending } from "@/components/registry-trending";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle, SectionTitle } from "@/components/ui/page-title";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { data: session } = useSession();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-12">
        <section className="space-y-4 py-12 text-center">
          <PageTitle className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
            Skills that run and improve themselves
          </PageTitle>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:delay-100 motion-safe:fill-mode-both">
            The realtime registry for Agent Skills. Publish a SKILL.md and it goes live at the edge
            in under 10ms, runs in a hosted sandbox, and improves from approved feedback. Works with
            Claude Code, Cursor, VS Code, and any{" "}
            <a href="https://agentskills.io/home" className="text-primary underline">
              agentskills.io
            </a>{" "}
            client.
          </p>
          <div className="flex justify-center gap-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:delay-200 motion-safe:fill-mode-both">
            <Button size="lg" asChild>
              <Link to="/registry">Browse registry</Link>
            </Button>
            {session?.user && (
              <Button size="lg" variant="outline" asChild>
                <Link to="/dashboard">Open dashboard</Link>
              </Button>
            )}
          </div>
          <div className="pt-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:delay-300 motion-safe:fill-mode-both">
            <RealtimeFanout />
          </div>
        </section>

        <section className="mx-auto max-w-xl space-y-3">
          <h2 className="text-center text-lg font-semibold">Registry MCP</h2>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Connect via MCP</CardTitle>
              <CardDescription>
                Search and install skills from any MCP-compatible agent
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <InstallSnippet
                command='{ "mcpServers": { "skillist-registry": { "url": "https://api.skillist.io/mcp" } } }'
                prefix="Cursor .cursor/mcp.json"
              />
              <p className="text-sm text-muted-foreground">
                Tools: registry_search, registry_get_skill, registry_facets, registry_install_help.
                Streamable HTTP with OAuth via{" "}
                <a href="https://docs.skillist.io/mcp/connect/" className="text-primary underline">
                  docs
                </a>
                .{" "}
                <a href="https://api.skillist.io/mcp" className="text-primary underline">
                  Server info
                </a>
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="mx-auto max-w-xl space-y-3">
          <h2 className="text-center text-lg font-semibold">Quick start</h2>
          <Card>
            <CardContent className="space-y-3 pt-6">
              <InstallSnippet command="npm install -g @skillist/cli" prefix="Install the CLI" />
              <InstallSnippet command="skillist search performance" prefix="Search the registry" />
              <InstallSnippet
                command="skillist install skillist/web-perf-audit"
                prefix="Install a skill"
              />
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-center text-lg font-semibold">Platform</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                title: "Hosted execution",
                desc: "Skills run their scripts in isolated sandboxes with streaming output and quotas — not just downloaded.",
              },
              {
                title: "Self-improving",
                desc: "AI drafts improvements from approved feedback; evals measure the uplift before you publish.",
              },
              {
                title: "Realtime delivery",
                desc: "Publish once and SKILL.md fans out to the edge in under 10ms, with live presence and eval status.",
              },
            ].map((f) => (
              <Card key={f.title} className="flex flex-col">
                <CardHeader>
                  <CardTitle>{f.title}</CardTitle>
                  <CardDescription>{f.desc}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <SectionTitle>Featured skills</SectionTitle>
            <p className="text-muted-foreground">
              Curated picks to get started. Install with one command.
            </p>
          </div>
          <RegistryFeatured />
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <SectionTitle>Trending skills</SectionTitle>
            <Button variant="outline" asChild>
              <Link to="/registry">View all</Link>
            </Button>
          </div>
          <RegistryTrending />
        </section>
      </div>
    </TooltipProvider>
  );
}
