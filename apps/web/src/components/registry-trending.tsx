import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { StarButton } from "@/components/registry-star-button";
import { ScoreReadout } from "@/components/score-readout";
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
        <Card
          key={`${item.orgSlug}/${item.skillRepo}`}
          size="sm"
          className="group flex flex-col transition-[background-color,box-shadow] duration-200 hover:bg-[color-mix(in_oklch,var(--card),var(--foreground)_3%)] hover:ring-foreground/15"
        >
          <CardHeader className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-base">
                  <Link
                    to="/$org/$repo"
                    params={{ org: item.orgSlug, repo: item.skillRepo }}
                    className="outline-none transition-colors hover:text-signal focus-visible:text-signal"
                  >
                    {item.name}
                  </Link>
                </CardTitle>
                <CardDescription className="truncate">
                  {item.orgSlug}/{item.skillRepo}
                </CardDescription>
              </div>
              <StarButton org={item.orgSlug} repo={item.skillRepo} stars={item.stars} />
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
          </CardHeader>
          <CardContent className="mt-auto space-y-3">
            <ScoreReadout
              quality={item.qualityScore}
              impact={item.impactScore}
              security={item.securityStatus}
            />
            {item.compatibleAgents?.length ? (
              <p className="truncate text-[0.65rem] font-semibold tracking-widest text-muted-foreground uppercase">
                {item.compatibleAgents.join(" · ")}
              </p>
            ) : null}
            <div className="border-t border-border pt-3">
              <Link
                to="/$org/$repo"
                params={{ org: item.orgSlug, repo: item.skillRepo }}
                className="inline-flex w-fit items-center gap-1 text-sm font-medium text-foreground outline-none transition-colors hover:text-signal focus-visible:text-signal"
              >
                View skill
                <span
                  aria-hidden
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
