import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegistryTrending } from "@/components/registry-trending";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="space-y-12">
      <section className="space-y-4 py-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Realtime Agent Skills
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Manage, version, and deliver SKILL.md files with sub-10ms fan-out.
          Built for the{" "}
          <a
            href="https://agentskills.io/home"
            className="text-primary underline"
          >
            agentskills.io
          </a>{" "}
          standard.
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
