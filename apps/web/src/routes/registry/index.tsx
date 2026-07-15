import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type RegistryItem } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScoreBadges, InstallSnippet } from "@/components/score-badges";
import { useState } from "react";

export const Route = createFileRoute("/registry/")({
  component: RegistryPage,
});

function RegistryPage() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["registry", q],
    queryFn: () =>
      api<{ items: RegistryItem[]; total: number }>(
        `/v1/registry?q=${encodeURIComponent(q)}`,
      ),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Public Registry</h1>
        <p className="text-muted-foreground">
          Discover Agent Skills with quality, impact, and security scores
        </p>
      </div>
      <Input
        placeholder="Search skills..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />
      {isLoading ? (
        <p>Loading...</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data?.items.map((item) => (
            <Card key={`${item.orgSlug}/${item.skillSlug}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{item.name}</CardTitle>
                    <CardDescription>
                      {item.orgSlug}/{item.skillSlug}
                    </CardDescription>
                  </div>
                  {item.latestVersion && (
                    <Badge>v{item.latestVersion}</Badge>
                  )}
                </div>
                <ScoreBadges
                  quality={item.qualityScore}
                  impact={item.impactScore}
                  security={item.securityStatus}
                />
                {item.runtime && item.runtime !== "local" && (
                  <Badge variant="secondary" className="text-xs">
                    {item.runtime} runtime
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">{item.description}</p>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{item.installCount} installs</span>
                  <span>{item.activationCount} activations</span>
                  <span>{item.stars} stars</span>
                </div>
                <InstallSnippet
                  command={
                    item.installCommand ??
                    `skillist install ${item.orgSlug}/${item.skillSlug}`
                  }
                />
                <Link
                  to="/registry/$org/$slug"
                  params={{ org: item.orgSlug, slug: item.skillSlug }}
                  className="text-sm text-primary hover:underline"
                >
                  View skill →
                </Link>
              </CardContent>
            </Card>
          ))}
          {data?.items.length === 0 && (
            <p className="text-muted-foreground">
              No public skills yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
