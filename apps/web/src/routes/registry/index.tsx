import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type RegistryItem } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/input";
import { Input } from "@/components/ui/input";
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
        <p className="text-[var(--color-muted-foreground)]">
          Discover Agent Skills compatible with agentskills.io
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
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{item.name}</CardTitle>
                  {item.latestVersion && (
                    <Badge>v{item.latestVersion}</Badge>
                  )}
                </div>
                <CardDescription>
                  {item.orgSlug}/{item.skillSlug}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm">{item.description}</p>
                <Link
                  to="/registry/$org/$slug"
                  params={{ org: item.orgSlug, slug: item.skillSlug }}
                  className="text-sm text-[var(--color-primary)] hover:underline"
                >
                  View skill →
                </Link>
              </CardContent>
            </Card>
          ))}
          {data?.items.length === 0 && (
            <p className="text-[var(--color-muted-foreground)]">
              No public skills yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
