import { api, Button, type RegistryItem, ScoreReadout } from "@skillist/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PublicEvalBadge } from "@/components/public-eval-badge";

const FEATURED = [
  {
    org: "skillist",
    slug: "registry-mcp",
    pitch: "Search and install skills via MCP: connect to api.skillist.io/mcp.",
  },
  {
    org: "skillist",
    slug: "web-perf-audit",
    pitch: "Run Lighthouse-style audits in a hosted sandbox with streaming output.",
  },
  {
    org: "skillist",
    slug: "security-audit",
    pitch: "Review PRs for injection, auth gaps, and OWASP-class issues.",
  },
  {
    org: "skillist",
    slug: "cloudflare-deploy",
    pitch: "Deploy Workers with preflight scripts. Works in Cursor, Claude, and VS Code.",
  },
  {
    org: "skillist",
    slug: "roll-dice",
    pitch: "Minimal starter skill for verifying your agent setup.",
  },
] as const;

export function RegistryFeatured() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["registry", "featured"],
    queryFn: async ({ signal }) => {
      const items = await Promise.all(
        FEATURED.map((f) => api<RegistryItem>(`/v1/registry/${f.org}/${f.slug}`, { signal })),
      );
      return FEATURED.map((f, i) => ({
        ...f,
        item: items[i]!,
      }));
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading featured skills…</p>;
  }

  if (isError) {
    return (
      <div className="flex items-center gap-3 text-sm text-destructive">
        <p>Could not load featured skills.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
      {data?.map(({ org, slug, pitch, item }) => (
        <article
          key={`${org}/${slug}`}
          className="group flex flex-col gap-3 bg-background p-5 transition-colors hover:bg-[color-mix(in_oklch,var(--background),var(--foreground)_3%)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-headline text-foreground">
                <Link
                  to="/$org/$repo"
                  params={{ org, repo: slug }}
                  className="outline-none transition-colors hover:text-signal focus-visible:text-signal"
                >
                  {item.name}
                </Link>
              </h3>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {org}/{slug}
              </p>
            </div>
            {item.runtime && item.runtime !== "local" && (
              <span className="shrink-0 font-mono text-[0.65rem] tracking-wide text-muted-foreground uppercase">
                hosted:{item.runtime}
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{pitch}</p>
          <div className="mt-auto flex flex-col gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <ScoreReadout
                quality={item.qualityScore}
                impact={item.impactScore}
                security={item.securityStatus}
              />
              <PublicEvalBadge eval={item.eval} />
            </div>
            <div className="border-t border-border pt-3">
              <Link
                to="/$org/$repo"
                params={{ org, repo: slug }}
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
      {/* Trailing cell fills the ruled grid (5 skills + this = 6) and doubles as
          a way into the full registry. */}
      <Link
        to="/registry"
        className="group flex flex-col items-start justify-center gap-1 bg-background p-5 transition-colors hover:bg-[color-mix(in_oklch,var(--background),var(--foreground)_3%)]"
      >
        <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          More
        </span>
        <span className="inline-flex items-center gap-1 text-headline text-foreground transition-colors group-hover:text-signal">
          Browse the registry
          <span
            aria-hidden
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          >
            →
          </span>
        </span>
      </Link>
    </div>
  );
}
