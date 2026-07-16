import { createFileRoute } from '@tanstack/react-router'
import { apiUrl } from "@/lib/api-url";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type RegistryItem, type SkillRunResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScoreBadges, InstallSnippet } from "@/components/score-badges";
import { useSkillRealtime } from "@/hooks/use-skill-realtime";
import { Wifi, WifiOff, Play } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/registry/$org/$slug")({
  component: RegistrySkillPage,
});

function RegistrySkillPage() {
  const { org, slug } = Route.useParams();
  const queryClient = useQueryClient();
  const { connected, lastEvent } = useSkillRealtime(org, slug);
  const [targetUrl, setTargetUrl] = useState("https://skillist.dev");
  const [selectedScript, setSelectedScript] = useState("");
  const [runOutput, setRunOutput] = useState<string | null>(null);

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

  const runScript = useMutation({
    mutationFn: (scriptPath: string) =>
      api<SkillRunResult>(`/v1/skills/${org}/${slug}/run`, {
        method: "POST",
        body: JSON.stringify({
          scriptPath,
          targetUrl: targetUrl || undefined,
        }),
      }),
    onSuccess: (result) => {
      setRunOutput(
        [
          `exit ${result.exitCode} (${result.durationMs}ms) [${result.runtime}]`,
          result.stdout,
          result.stderr ? `stderr:\n${result.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      queryClient.invalidateQueries({ queryKey: ["registry", org, slug] });
    },
    onError: (err) => setRunOutput(err.message),
  });

  const installCmd =
    entry?.installCommand ?? `skillist install ${org}/${slug}`;
  const scripts = scriptsData?.scripts ?? [];
  const activeScript = selectedScript || scripts[0] || "";

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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-4 w-4" /> Run in Sandbox
            </CardTitle>
            <CardDescription>
              Execute bundled scripts in an isolated container on Skillist
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Script</Label>
              <select
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={activeScript}
                onChange={(e) => setSelectedScript(e.target.value)}
              >
                {scripts.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Target URL (optional)</Label>
              <Input
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://example.com"
              />
            </div>
            <InstallSnippet
              command={`skillist run ${org}/${slug} --script ${activeScript}${targetUrl ? ` --url ${targetUrl}` : ""}`}
            />
            <Button
              onClick={() => runScript.mutate(activeScript)}
              disabled={!activeScript || runScript.isPending}
            >
              {runScript.isPending ? "Running…" : "Run script"}
            </Button>
            {runOutput && (
              <pre className="max-h-64 overflow-auto rounded border bg-muted p-3 text-xs">
                {runOutput}
              </pre>
            )}
          </CardContent>
        </Card>
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
