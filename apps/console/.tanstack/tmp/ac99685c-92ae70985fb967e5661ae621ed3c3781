import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GitBranch, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import { api, type SkillSource, type SkillSourceSuggestion } from "@/lib/api";
import { requireAuth } from "@/lib/require-auth";

export const Route = createFileRoute("/admin/mirrors")({
  beforeLoad: () => requireAuth(),
  component: AdminMirrorsPage,
});

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "success") return "default";
  if (status === "failed") return "destructive";
  if (status === "running") return "secondary";
  return "outline";
}

function AdminMirrorsPage() {
  const queryClient = useQueryClient();

  const sources = useQuery({
    queryKey: ["admin", "sources"],
    queryFn: () => api<{ items: SkillSource[] }>("/v1/admin/sources"),
    retry: false,
  });

  const suggestions = useQuery({
    queryKey: ["admin", "source-suggestions"],
    queryFn: () =>
      api<{ items: SkillSourceSuggestion[] }>("/v1/admin/source-suggestions?status=pending"),
    retry: false,
    enabled: sources.isSuccess,
  });

  const syncSource = useMutation({
    mutationFn: (id: string) =>
      api<{ sourceId: string; status: string }>(`/v1/admin/sources/${id}/sync`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "sources"] }),
  });

  const syncAll = useMutation({
    mutationFn: () => api<{ status: string }>("/v1/admin/sources/sync-all", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "sources"] }),
  });

  const approve = useMutation({
    mutationFn: (id: string) =>
      api<{ sourceId: string; status: string }>(`/v1/admin/source-suggestions/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "sources"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "source-suggestions"] });
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) =>
      api<{ status: string }>(`/v1/admin/source-suggestions/${id}/reject`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "source-suggestions"] }),
  });

  if (sources.isError) {
    return (
      <div className="space-y-4">
        <PageTitle>Official mirrors</PageTitle>
        <p className="text-sm text-muted-foreground">
          Admin access required. Set <code className="bg-muted px-1">SKILLIST_ADMIN_USER_IDS</code>{" "}
          on the API Worker to your Better Auth user id.
        </p>
      </div>
    );
  }

  const items = sources.data?.items ?? [];
  const pending = suggestions.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle>Official mirrors</PageTitle>
          <p className="text-muted-foreground">
            Curated GitHub skill sources, sync status, and discovery suggestions
          </p>
        </div>
        <Button variant="outline" disabled={syncAll.isPending} onClick={() => syncAll.mutate()}>
          <RefreshCw className="mr-2 size-4" />
          {syncAll.isPending ? "Queueing…" : "Sync all sources"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Curated sources</CardTitle>
          <CardDescription>{items.length} repos configured for mirror sync</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sources.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading sources…</p>
          ) : items.length ? (
            items.map((source) => (
              <div
                key={source.id}
                className="flex flex-col gap-3 border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {source.githubOwner}/{source.githubRepo}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={statusVariant(source.lastSyncStatus)}>
                      {source.lastSyncStatus}
                    </Badge>
                    {source.pendingPublishCount > 0 && (
                      <span>
                        publishing {source.pendingPublishCount} skill
                        {source.pendingPublishCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {source.lastSyncedAt && (
                      <span>synced {new Date(source.lastSyncedAt).toLocaleString()}</span>
                    )}
                    {source.lastCommitSha && (
                      <span className="font-mono">{source.lastCommitSha.slice(0, 7)}</span>
                    )}
                  </div>
                  {source.lastSyncError && (
                    <p className="text-xs text-destructive">{source.lastSyncError}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={syncSource.isPending}
                  onClick={() => syncSource.mutate(source.id)}
                >
                  <GitBranch className="mr-2 size-4" />
                  Sync now
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No sources configured.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending suggestions</CardTitle>
          <CardDescription>Discovered repos awaiting admin approval</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {suggestions.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading suggestions…</p>
          ) : pending.length ? (
            pending.map((suggestion) => (
              <div
                key={suggestion.id}
                className="flex flex-col gap-3 border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {suggestion.githubOwner}/{suggestion.githubRepo}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    score {suggestion.matchScore} · {suggestion.stars} stars · via{" "}
                    {suggestion.discoveredVia}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={approve.isPending || reject.isPending}
                    onClick={() => approve.mutate(suggestion.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={approve.isPending || reject.isPending}
                    onClick={() => reject.mutate(suggestion.id)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No pending suggestions.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
