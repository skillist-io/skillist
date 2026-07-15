import { createFileRoute } from '@tanstack/react-router'
import { apiUrl } from "@/lib/api-url";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    queryFn: () => api<Record<string, unknown>>(`/v1/registry/${org}/${slug}`),
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {(entry?.name as string) ?? slug}
          </h1>
          <p className="text-muted-foreground">
            {org}/{slug}
          </p>
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
            {(meta?.description as string) ?? (entry?.description as string)}
          </p>
          <p>
            <strong>Version:</strong>{" "}
            {(meta?.version as string) ?? (entry?.latestVersion as string) ?? "—"}
          </p>
          <a
            href={apiUrl(`/v1/skills/${org}/${slug}/SKILL.md`)}
            className="text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Fetch SKILL.md (KV hot path)
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
