import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PublicEvalBadge } from "@/components/public-eval-badge";
import { InstallSnippet, ScoreBadges } from "@/components/score-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type RegistryItem } from "@/lib/api";

const FEATURED = [
  {
    org: "skillist",
    slug: "registry-mcp",
    pitch: "Search and install skills via MCP — connect to api.skillist.dev/mcp.",
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
    pitch: "Deploy Workers with preflight scripts — works in Cursor, Claude, and VS Code.",
  },
  {
    org: "skillist",
    slug: "roll-dice",
    pitch: "Minimal starter skill — great first install to verify your agent setup.",
  },
] as const;

export function RegistryFeatured() {
  const { data, isLoading } = useQuery({
    queryKey: ["registry", "featured"],
    queryFn: async () => {
      const items = await Promise.all(
        FEATURED.map((f) => api<RegistryItem>(`/v1/registry/${f.org}/${f.slug}`)),
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

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {data?.map(({ org, slug, pitch, item }) => (
        <Card key={`${org}/${slug}`} className="flex flex-col">
          <CardHeader className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{item.name}</CardTitle>
                <CardDescription>
                  {org}/{slug}
                </CardDescription>
              </div>
              {item.runtime && item.runtime !== "local" && (
                <Badge variant="secondary">Hosted {item.runtime}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{pitch}</p>
            <div className="flex flex-wrap items-center gap-2">
              <ScoreBadges
                quality={item.qualityScore}
                impact={item.impactScore}
                security={item.securityStatus}
              />
              <PublicEvalBadge eval={item.eval} />
            </div>
          </CardHeader>
          <CardContent className="mt-auto space-y-3">
            <InstallSnippet command={item.installCommand ?? `skillist install ${org}/${slug}`} />
            <Button variant="outline" size="sm" asChild>
              <Link to="/$org/$repo" params={{ org, repo: slug }}>
                View skill
              </Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
