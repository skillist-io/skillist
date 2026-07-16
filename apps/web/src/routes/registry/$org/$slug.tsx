import { createFileRoute } from '@tanstack/react-router'
import { apiUrl } from "@/lib/api-url";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type RegistryItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreBadges, InstallSnippet } from "@/components/score-badges";
import { SkillRunCard } from "@/components/skill-run-card";
import { useSkillRealtime } from "@/hooks/use-skill-realtime";
import { Wifi, WifiOff } from "lucide-react";

export const Route = createFileRoute("/registry/$org/$slug")({
  component: RegistrySkillPage,
});

function RegistrySkillPage() {
  const { org, slug } = Route.useParams();
  const queryClient = useQueryClient();
  const { connected, lastEvent } = useSkillRealtime(org, slug);

  const { data: entry } = useQuery({
    queryKey: ["registry", org, slug],
    queryFn: () => api<RegistryItem>(`/v1/registry/${org}/${slug}`),
  });

  const { data: scriptsData } = useQuery({
    queryKey: ["scripts", org, slug],
    queryFn: () =>
      api<{ runtime: string; scripts: string[] }>(
        `/v1/skills/${org}/${slug}/scripts`,
      ),
    enabled: entry?.runtime !== "local",
  });

  const { data: meta } = useQuery({
    queryKey: ["skill-meta", org, slug, lastEvent?.etag],
    queryFn: () => api<Record<string, unknown>>(`/v1/skills/${org}/${slug}/meta`),
  });

  const subscribe = useMutation({
    mutationFn: () =>
      api(`/v1/registry/${org}/${slug}/subscribe`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["registry"] }),
  });

  const installCmd =
    entry?.installCommand ?? `skillist install ${org}/${slug}`;
  const scripts = scriptsData?.scripts ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">
            {entry?.name ?? slug}
          </h1>
          <p className="text-muted-foreground">
            {org}/{slug}
          </p>
          <div className="flex flex-wrap gap-2">
            <ScoreBadges
              quality={entry?.qualityScore}
              impact={entry?.impactScore}
              security={entry?.securityStatus}
            />
            {entry?.runtime && entry.runtime !== "local" && (
              <Badge variant="secondary">Hosted {entry.runtime}</Badge>
            )}
          </div>
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
          <Button onClick={() => subscribe.mutate()} disabled={subscribe.isPending}>
            Subscribe
          </Button>
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
          slug={slug}
          scripts={scripts}
          defaultTargetUrl="https://skillist.dev"
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Install</CardTitle>
          <CardDescription>
            Use the Skillist CLI to install this skill into your project
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <InstallSnippet command={installCmd} />
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>{entry?.installCount ?? 0} installs</span>
            <span>{entry?.activationCount ?? 0} activations</span>
          </div>
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
            href={apiUrl(`/v1/skills/${org}/${slug}/SKILL.md`)}
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
