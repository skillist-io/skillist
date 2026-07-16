import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
            title: "Version & publish",
            desc: "Immutable version history with SKILL.md cached at the edge.",
          },
          {
            title: "Realtime delivery",
            desc: "WebSocket and SSE fan-out when skills publish.",
          },
          {
            title: "AI improvements",
            desc: "Human and agent feedback with approval workflows and AI suggestions.",
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
    </div>
  );
}
