import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type SkillRun } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type SkillRunHistoryProps = {
  org: string;
  repo: string;
  limit?: number;
};

export function SkillRunHistory({ org, repo, limit = 10 }: SkillRunHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data: session } = useSession();
  const isLoggedIn = Boolean(session?.user);

  const { data, isLoading } = useQuery({
    queryKey: ["runs", org, repo, limit],
    queryFn: () => api<{ items: SkillRun[] }>(`/${org}/${repo}/runs?limit=${limit}`),
    enabled: isLoggedIn,
  });

  const items = data?.items ?? [];

  if (!isLoggedIn) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Run history
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {["a", "b", "c"].map((k) => (
            <Skeleton key={k} className="h-11 w-full motion-reduce:animate-none" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Run history
        </CardTitle>
        <CardDescription>Recent hosted script executions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((run) => {
          const expanded = expandedId === run.id;
          return (
            <div key={run.id} className="border border-border text-sm">
              <button
                type="button"
                aria-expanded={expanded}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:-outline-offset-2"
                onClick={() => setExpandedId(expanded ? null : run.id)}
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium">{run.scriptPath}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={run.status === "completed" ? "default" : "secondary"}>
                    {run.status}
                  </Badge>
                  {run.exitCode != null && (
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        run.exitCode === 0 ? "text-muted-foreground" : "text-destructive",
                      )}
                    >
                      exit {run.exitCode}
                    </span>
                  )}
                </div>
              </button>
              {expanded && (
                <div className="space-y-2 border-t px-3 py-2">
                  {run.durationMs != null && (
                    <p className="text-xs text-muted-foreground">
                      {run.durationMs}ms · {run.runtime}
                    </p>
                  )}
                  {run.stdout && (
                    <pre className="max-h-40 overflow-auto bg-muted p-2 text-xs">{run.stdout}</pre>
                  )}
                  {run.stderr && (
                    <pre className="max-h-40 overflow-auto border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                      {run.stderr}
                    </pre>
                  )}
                  {run.error && <p className="text-xs text-destructive">{run.error}</p>}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
