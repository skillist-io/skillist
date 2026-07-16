import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type RegistryItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreBadges, InstallSnippet } from "@/components/score-badges";
import { StarButton } from "@/components/registry-star-button";
import { SkillRunCard } from "@/components/skill-run-card";
import { SkillRunHistory } from "@/components/skill-run-history";
import { AgentInstallButtons } from "@/components/agent-install-buttons";
import { PublicEvalBadge } from "@/components/public-eval-badge";
import { SkillAnalyticsChart } from "@/components/skill-analytics-chart";
import { useSkillRealtime } from "@/hooks/use-skill-realtime";
import { Wifi, WifiOff } from "lucide-react";

type PluginManifest = {
  agents?: string[];
  rules?: string[];
  mcp?: { servers?: { name: string; url?: string }[] };
};

export const Route = createFileRoute("/$org/$repo")({
  component: SkillRepoPage,
});

function SkillRepoPage() {
  const { org, repo } = Route.useParams();
  const queryClient = useQueryClient();
  const { connected, lastEvent } = useSkillRealtime(org, repo);

  const { data: entry } = useQuery({
    queryKey: ["registry", org, repo],
    queryFn: () => api<RegistryItem>(`/v1/registry/${org}/${repo}`),
  });

  const { data: scriptsData } = useQuery({
    queryKey: ["scripts", org, repo],
    queryFn: () =>
      api<{ runtime: string; scripts: string[] }>(
        `/${org}/${repo}/scripts`,
      ),
    enabled: entry?.runtime !== "local",
  });

  const { data: meta } = useQuery({
    queryKey: ["skill-meta", org, repo, lastEvent?.etag],
    queryFn: () =>
      api<Record<string, unknown>>(`/${org}/${repo}/meta`),
  });

  const subscribe = useMutation({
    mutationFn: () =>
      api(`/v1/registry/${org}/${repo}/subscribe`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["registry"] }),
  });

  const installCmd =
    entry?.installCommand ?? `skillist install ${org}/${repo}`;
  const cliInstall = entry?.cliInstall ?? "npm install -g @skillist/cli";
  const scripts = scriptsData?.scripts ?? [];
  const manifest = entry?.pluginManifest as PluginManifest | null | undefined;
  const mcpServers = manifest?.mcp?.servers ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{entry?.name ?? repo}</h1>
          <p className="text-muted-foreground">
            {org}/{repo}
          </p>
          <div className="flex flex-wrap gap-2">
            <ScoreBadges
              quality={entry?.qualityScore}
              impact={entry?.impactScore}
              security={entry?.securityStatus}
            />
            <PublicEvalBadge eval={entry?.eval} />
            {entry?.runtime && entry.runtime !== "local" && (
              <Badge variant="secondary">Hosted {entry.runtime}</Badge>
            )}
            {entry?.category && (
              <Badge variant="outline">{entry.category}</Badge>
            )}
          </div>
          {entry?.tags?.length ? (
            <div className="flex flex-wrap gap-1">
              {entry.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <Badge className="gap-1 text-green-700">
              <Wifi className="h-3 w-3" /> Live
            </Badge>
          ) : (
            <Badge className="gap-1">
              <WifiOff className="h-3 w-3" /> Offline
            </Badge>
          )}
          <Button
            onClick={() => subscribe.mutate()}
            disabled={subscribe.isPending}
          >
            Subscribe
          </Button>
          <StarButton
            org={org}
            repo={repo}
            stars={entry?.stars ?? 0}
            starred={entry?.starred}
          />
        </div>
      </div>

      {lastEvent && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-4 text-sm">
            Published v{lastEvent.version} at{" "}
            {new Date(lastEvent.publishedAt).toLocaleString()}
          </CardContent>
        </Card>
      )}

      {scripts.length > 0 && (
        <SkillRunCard
          org={org}
          repo={repo}
          scripts={scripts}
          defaultTargetUrl="https://skillist.dev"
        />
      )}

      {entry?.runtime && entry.runtime !== "local" && (
        <SkillRunHistory org={org} repo={repo} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Install</CardTitle>
          <CardDescription>
            Install the CLI, then add this skill to your agent
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <InstallSnippet command={cliInstall} prefix="1. Install CLI" />
          <AgentInstallButtons
            org={org}
            repo={repo}
            agents={entry?.compatibleAgents}
            installCommand={installCmd}
          />
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>{entry?.installCount ?? 0} installs</span>
            <span>{entry?.activationCount ?? 0} activations</span>
            <span>{entry?.stars ?? 0} stars</span>
          </div>
        </CardContent>
      </Card>

      <SkillAnalyticsChart org={org} repo={repo} />

      {mcpServers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>MCP servers</CardTitle>
            <CardDescription>
              Model Context Protocol servers declared in plugin.json
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {mcpServers.map((server) => (
              <div
                key={server.name}
                className="rounded border px-3 py-2 text-sm"
              >
                <p className="font-medium">{server.name}</p>
                {server.url && (
                  <p className="text-muted-foreground">{server.url}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {manifest?.rules?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Plugin rules</CardTitle>
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
          <CardTitle>Agent compatibility</CardTitle>
          <CardDescription>
            From plugin.json — which agents can discover this skill
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {entry?.compatibleAgents?.length ? (
            entry.compatibleAgents.map((agent) => (
              <Badge key={agent} variant="secondary">
                {agent}
              </Badge>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No agents declared in plugin.json
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Discovery metadata</CardTitle>
          <CardDescription>
            Progressive disclosure — name and description only
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>Description:</strong>{" "}
            {(meta?.description as string) ?? entry?.description}
          </p>
          <p>
            <strong>Version:</strong>{" "}
            {(meta?.version as string) ?? entry?.latestVersion ?? "—"}
          </p>
          <a
            href={`/${org}/${repo}/SKILL.md`}
            className="text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Fetch SKILL.md
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
