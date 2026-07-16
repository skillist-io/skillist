import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type RegistryItem } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBadges } from "@/components/score-badges";
import { StarButton } from "@/components/registry-star-button";

export function RegistryTrending() {
  const { data, isLoading } = useQuery({
    queryKey: ["registry", "trending"],
    queryFn: () =>
      api<{ items: RegistryItem[] }>("/v1/registry?sort=trending&limit=6"),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading trending skills…</p>;
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
        <Card key={`${item.orgSlug}/${item.skillSlug}`}>
          <CardHeader className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{item.name}</CardTitle>
                <CardDescription>
                  {item.orgSlug}/{item.skillSlug}
                </CardDescription>
              </div>
              <StarButton
                org={item.orgSlug}
                slug={item.skillSlug}
                stars={item.stars}
              />
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
          <CardContent className="space-y-2">
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {item.description}
            </p>
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
    </div>
  );
}
