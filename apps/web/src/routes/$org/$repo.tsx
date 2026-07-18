import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { WifiOff } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { AgentInstallButtons } from "@/components/agent-install-buttons";
import { CopyButton } from "@/components/copy-button";
import { PublicEvalBadge } from "@/components/public-eval-badge";
import { QueryError } from "@/components/query-error";
import { ScoreReadout } from "@/components/score-readout";
import { SkillAnalyticsChart } from "@/components/skill-analytics-chart";
import { SkillRunCard } from "@/components/skill-run-card";
import { SkillRunHistory } from "@/components/skill-run-history";
import { StarStat } from "@/components/star-stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSkillRealtime } from "@/hooks/use-skill-realtime";
import { api, type RegistryItem } from "@/lib/api";
import { formatCount } from "@/lib/utils";

type PluginManifest = {
  agents?: string[];
  rules?: string[];
  mcp?: { servers?: { name: string; url?: string }[] };
};

const SkillReadme = lazy(() => import("@/components/skill-readme"));
const SkillBundleBrowser = lazy(() => import("@/components/skill-bundle-browser"));

export const Route = createFileRoute("/$org/$repo")({
  component: SkillRepoPage,
});

function SkillRepoPage() {
  const { org, repo } = Route.useParams();
  const queryClient = useQueryClient();
  const { connected, lastEvent } = useSkillRealtime(org, repo);
  const [viewedBundlePath, setViewedBundlePath] = useState<string | null>(null);

  const {
    data: entry,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["registry", org, repo],
    queryFn: () => api<RegistryItem>(`/v1/registry/${org}/${repo}`),
  });

  const { data: scriptsData } = useQuery({
    queryKey: ["scripts", org, repo],
    queryFn: () => api<{ runtime: string; scripts: string[] }>(`/${org}/${repo}/scripts`),
    enabled: entry?.runtime !== "local",
  });

  const { data: meta } = useQuery({
    queryKey: ["skill-meta", org, repo, lastEvent?.etag],
    queryFn: () => api<Record<string, unknown>>(`/${org}/${repo}/meta`),
  });

  const subscribe = useMutation({
    mutationFn: () => api(`/v1/registry/${org}/${repo}/subscribe`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["registry"] }),
  });

  const installCmd = entry?.installCommand ?? `skillist install ${org}/${repo}`;
  const cliInstall = entry?.cliInstall ?? "npm install -g @skillist/cli";
  const scripts = scriptsData?.scripts ?? [];
  const manifest = entry?.pluginManifest as PluginManifest | null | undefined;
  const mcpServers = manifest?.mcp?.servers ?? [];
  const hosted = entry?.runtime && entry.runtime !== "local";
  const description = (meta?.description as string) ?? entry?.description;
  const version = (meta?.version as string) ?? entry?.latestVersion ?? "—";

  if (isError) {
    return (
      <QueryError
        title="Could not load this skill"
        message="We couldn't reach the Skillist API for this skill. Check your connection and try again."
        onRetry={() => void refetch()}
      />
    );
  }

  if (isLoading && !entry) return <SkillDetailSkeleton org={org} repo={repo} />;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-8">
        {/* Adopt header: identity + one consolidated trust row */}
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 space-y-1.5">
              <h1 className="text-3xl font-bold tracking-tight text-balance">
                {entry?.name ?? repo}
              </h1>
              <p className="font-mono text-sm text-muted-foreground">
                {org}/{repo}
                {version !== "—" ? ` · v${version}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <LiveIndicator connected={connected} />
              <Button
                variant="outline"
                onClick={() => subscribe.mutate()}
                disabled={subscribe.isPending || subscribe.isSuccess}
              >
                {subscribe.isSuccess ? "Subscribed" : "Subscribe"}
              </Button>
              <StarStat
                org={org}
                repo={repo}
                stars={entry?.stars ?? 0}
                starred={entry?.starred}
                withIcon
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <ScoreReadout
              quality={entry?.qualityScore}
              impact={entry?.impactScore}
              security={entry?.securityStatus}
            />
            <PublicEvalBadge eval={entry?.eval} />
            {entry?.sourceType === "mirror" && <Badge variant="outline">Mirror</Badge>}
            {hosted && <Badge variant="secondary">Hosted {entry?.runtime}</Badge>}
            {entry?.category && <Badge variant="outline">{entry.category}</Badge>}
          </div>

          {entry?.sourceType === "mirror" && entry.upstreamUrl && (
            <p className="max-w-prose border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground text-pretty">
              Mirrored from{" "}
              <a
                href={entry.upstreamUrl}
                className="text-foreground underline-offset-2 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {entry.upstreamRepo ?? "upstream"}
              </a>
              . Not officially hosted by Skillist — we run our own evals and security scans.
            </p>
          )}

          {description && (
            <p className="max-w-prose text-sm text-muted-foreground text-pretty">{description}</p>
          )}

          {entry?.tags?.length ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {entry.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}

          {lastEvent && (
            <p className="border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
              Published v{lastEvent.version} · {new Date(lastEvent.publishedAt).toLocaleString()}
            </p>
          )}
        </header>

        {/* Body: primary adopt/run column + secondary reference rail */}
        <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8 lg:space-y-0">
          <div className="space-y-8">
            <Suspense fallback={null}>
              <SkillReadme
                org={org}
                repo={repo}
                etag={lastEvent?.etag}
                onOpenFile={setViewedBundlePath}
              />
            </Suspense>

            <Card>
              <CardHeader>
                <CardTitle>Install</CardTitle>
                <CardDescription>
                  Install the CLI, then add this skill to your agent
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    1. Install the CLI
                  </p>
                  <CommandRow value={cliInstall} />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    2. Add the skill
                  </p>
                  <AgentInstallButtons
                    org={org}
                    repo={repo}
                    agents={entry?.compatibleAgents}
                    installCommand={installCmd}
                  />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-4 font-mono text-xs text-muted-foreground tabular-nums">
                  <span>{formatCount(entry?.installCount ?? 0)} installs</span>
                  <span>{formatCount(entry?.activationCount ?? 0)} activations</span>
                  <span>{formatCount(entry?.stars ?? 0)} stars</span>
                </div>
              </CardContent>
            </Card>

            {scripts.length > 0 && (
              <SkillRunCard
                org={org}
                repo={repo}
                scripts={scripts}
                defaultTargetUrl="https://skillist.dev"
              />
            )}

            {hosted && <SkillRunHistory org={org} repo={repo} />}

            <SkillAnalyticsChart org={org} repo={repo} />
          </div>

          {/* Reference rail */}
          <aside className="space-y-6 lg:sticky lg:top-20">
            <Suspense fallback={null}>
              <SkillBundleBrowser
                org={org}
                repo={repo}
                etag={lastEvent?.etag}
                viewedPath={viewedBundlePath}
                onViewPath={setViewedBundlePath}
              />
            </Suspense>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Agent compatibility</CardTitle>
                <CardDescription>Which agents can discover this skill</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-x-3 gap-y-1">
                {entry?.compatibleAgents?.length ? (
                  entry.compatibleAgents.map((agent) => (
                    <Badge key={agent} variant="secondary">
                      {agent}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No agents declared in plugin.json</p>
                )}
              </CardContent>
            </Card>

            {mcpServers.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">MCP servers</CardTitle>
                  <CardDescription>Declared in plugin.json</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {mcpServers.map((server) => (
                    <div key={server.name} className="border border-border px-3 py-2 text-sm">
                      <p className="font-medium">{server.name}</p>
                      {server.url && (
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {server.url}
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {manifest?.rules?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Plugin rules</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {manifest.rules.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Source</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-xs">
                  <dt className="text-muted-foreground">type</dt>
                  <dd>{entry?.sourceType === "mirror" ? "mirror" : "native"}</dd>
                  <dt className="text-muted-foreground">version</dt>
                  <dd className="tabular-nums">{version}</dd>
                  {entry?.upstreamRepo && (
                    <>
                      <dt className="text-muted-foreground">upstream</dt>
                      <dd className="truncate">{entry.upstreamRepo}</dd>
                    </>
                  )}
                </dl>
                {entry?.upstreamUrl && (
                  <a
                    href={entry.upstreamUrl}
                    className="inline-flex rounded-none text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on GitHub →
                  </a>
                )}
                <a
                  href={`/${org}/${repo}/SKILL.md`}
                  className="inline-flex rounded-none text-primary hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                  target="_blank"
                  rel="noreferrer"
                >
                  Fetch SKILL.md →
                </a>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** Monochrome realtime indicator: a pulsing instrument LED, not a colored badge. */
function LiveIndicator({ connected }: { connected: boolean }) {
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-foreground uppercase">
        <span className="size-1.5 bg-foreground motion-safe:animate-pulse" aria-hidden />
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      <WifiOff className="size-3" aria-hidden />
      Offline
    </span>
  );
}

/** A squared command line with a copy-with-feedback affordance. */
function CommandRow({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 overflow-x-auto bg-muted px-2 py-1.5 font-mono text-xs">{value}</code>
      <CopyButton value={value} label="Copy" size="sm" />
    </div>
  );
}

function SkillDetailSkeleton({ org, repo }: { org: string; repo: string }) {
  return (
    <div className="space-y-8" aria-hidden>
      <p className="sr-only" role="status">
        Loading skill
      </p>
      <header className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64 motion-reduce:animate-none" />
            <Skeleton className="h-4 w-40 motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-10 w-40 motion-reduce:animate-none" />
        </div>
        <Skeleton className="h-4 w-72 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-full max-w-prose motion-reduce:animate-none" />
      </header>
      <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8 lg:space-y-0">
        <Skeleton className="h-64 w-full motion-reduce:animate-none" />
        <Skeleton className="h-48 w-full motion-reduce:animate-none" />
      </div>
      <span className="sr-only">
        {org}/{repo}
      </span>
    </div>
  );
}
