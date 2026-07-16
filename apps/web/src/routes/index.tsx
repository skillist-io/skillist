import { createFileRoute, Link } from "@tanstack/react-router";
import { RegistryFeatured } from "@/components/registry-featured";
import { RegistryTrending } from "@/components/registry-trending";
import { InstallSnippet } from "@/components/score-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="space-y-12">
      <section className="space-y-4 py-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Realtime Agent Skills</h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Manage, version, and deliver SKILL.md files with sub-10ms fan-out. Works with Cursor,
          Claude Code, VS Code, and any{" "}
          <a href="https://agentskills.io/home" className="text-primary underline">
            agentskills.io
          </a>{" "}
          client.
        </p>
        <div className="flex justify-center gap-3">
          <Button size="lg" asChild>
            <Link to="/registry">Browse registry</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/dashboard">Open dashboard</Link>
          </Button>
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
              command='{ "mcpServers": { "skillist-registry": { "url": "https://api.skillist.dev/mcp" } } }'
              prefix="Cursor .cursor/mcp.json"
            />
            <p className="text-sm text-muted-foreground">
              Tools: registry_search, registry_get_skill, registry_facets, registry_install_help.
              Streamable HTTP with OAuth via{" "}
              <a href="https://docs.skillist.dev/mcp/connect/" className="text-primary underline">
                docs
              </a>
              .{" "}
              <a href="https://api.skillist.dev/mcp" className="text-primary underline">
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

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          {
            title: "Hosted execution",
            desc: "Run skill scripts in isolated sandboxes with streaming output and quotas.",
          },
          {
            title: "Evals & observability",
            desc: "Measure skill uplift, track regression across versions, and monitor runs.",
          },
          {
            title: "Registry discovery",
            desc: "Search by tags, agents, runtime, and trending — install via CLI.",
          },
        ].map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <CardTitle>{f.title}</CardTitle>
              <CardDescription>{f.desc}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold">Featured skills</h2>
          <p className="text-muted-foreground">
            Curated picks to get started — install with one command
          </p>
        </div>
        <RegistryFeatured />
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Trending skills</h2>
          <Button variant="outline" asChild>
            <Link to="/registry">View all</Link>
          </Button>
        </div>
        <RegistryTrending />
      </section>
    </div>
  );
}
