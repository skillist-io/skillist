import { api, Button, type RegistryItem, ScoreReadout } from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { StarButton } from "@/components/registry-star-button";

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
    <div className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
      {data.items.map((item, i) => (
        <article
          key={`${item.orgSlug}/${item.skillRepo}`}
          className="group flex flex-col gap-3 bg-background p-5 transition-colors hover:bg-[color-mix(in_oklch,var(--background),var(--foreground)_3%)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                {`0${i + 1}`}
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-headline text-foreground">
                  <Link
                    to="/$org/$repo"
                    params={{ org: item.orgSlug, repo: item.skillRepo }}
                    className="outline-none transition-colors hover:text-signal focus-visible:text-signal"
                  >
                    {item.name}
                  </Link>
                </h3>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {item.orgSlug}/{item.skillRepo}
                </p>
              </div>
            </div>
            <StarButton org={item.orgSlug} repo={item.skillRepo} stars={item.stars} />
          </div>
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {item.description}
          </p>
          <div className="mt-auto flex flex-col gap-3 pt-1">
            <ScoreReadout
              quality={item.qualityScore}
              impact={item.impactScore}
              security={item.securityStatus}
            />
            {item.compatibleAgents?.length ? (
              <p className="truncate font-mono text-[0.65rem] tracking-wide text-muted-foreground lowercase">
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
          </div>
        </article>
      ))}
    </div>
  );
}
