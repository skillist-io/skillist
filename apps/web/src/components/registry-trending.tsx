import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { StarButton } from "@/components/registry-star-button";
import { ScoreBadges } from "@/components/score-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type RegistryItem } from "@/lib/api";

export function RegistryTrending() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["registry", "trending"],
    queryFn: ({ signal }) =>
      api<{ items: RegistryItem[] }>("/v1/registry?sort=trending&limit=6", { signal }),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading trending skills…</p>;
  }

  if (isError) {
    return (
      <div className="flex items-center gap-3 text-sm text-destructive">
        <p>Could not load trending skills.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data?.items.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No public skills yet.{" "}
        <Link to="/registry" className="text-primary underline">
          Browse registry
        </Link>
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.items.map((item) => (
        <Card key={`${item.orgSlug}/${item.skillRepo}`} className="flex flex-col">
          <CardHeader className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{item.name}</CardTitle>
                <CardDescription>
                  {item.orgSlug}/{item.skillRepo}
                </CardDescription>
              </div>
              <StarButton org={item.orgSlug} repo={item.skillRepo} stars={item.stars} />
            </div>
            <ScoreBadges
              quality={item.qualityScore}
              impact={item.impactScore}
              security={item.securityStatus}
            />
            {item.compatibleAgents?.map((agent) => (
              <Badge key={agent} variant="secondary" className="text-xs">
                {agent}
              </Badge>
            ))}
          </CardHeader>
          <CardContent className="mt-auto space-y-2">
            <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
            <Link
              to="/$org/$repo"
              params={{ org: item.orgSlug, repo: item.skillRepo }}
              className="text-sm text-primary hover:underline"
            >
              View skill <span aria-hidden="true">→</span>
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
