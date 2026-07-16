import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type SkillEval } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SkillEvalPanelProps = {
  orgId: string;
  slug: string;
  versionId?: string;
  onRunEval: () => void;
  isRunning: boolean;
};

function statusVariant(status: string) {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  if (status === "running") return "secondary";
  return "outline";
}

export function SkillEvalPanel({
  orgId,
  slug,
  versionId,
  onRunEval,
  isRunning,
}: SkillEvalPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: evals } = useQuery({
    queryKey: ["evals", orgId, slug],
    queryFn: () =>
      api<{ items: SkillEval[] }>(`/v1/orgs/${orgId}/skills/${slug}/evals`),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const pending = items.some(
        (ev) => ev.status === "queued" || ev.status === "running",
      );
      return pending ? 3000 : false;
    },
  });

  const { data: detail } = useQuery({
    queryKey: ["eval", orgId, slug, expandedId],
    queryFn: () =>
      api<{ eval: SkillEval }>(
        `/v1/orgs/${orgId}/skills/${slug}/evals/${expandedId}`,
      ),
    enabled: !!expandedId,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Evals</CardTitle>
          <CardDescription>
            Baseline vs with-skill uplift across scenarios
          </CardDescription>
        </div>
        {versionId && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRunEval}
            disabled={isRunning}
          >
            {isRunning ? "Queuing…" : "Run eval"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {evals?.items?.length ? (
          evals.items.map((ev) => {
            const open = expandedId === ev.id;
            const results = open ? detail?.eval?.results : ev.results;
            return (
              <div key={ev.id} className="rounded border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left hover:bg-muted/50"
                  onClick={() => setExpandedId(open ? null : ev.id)}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(ev.status)}>{ev.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {ev.semver ? `v${ev.semver} · ` : ""}
                      {new Date(ev.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <span className="font-mono text-xs">
                    {ev.baselineScore != null && ev.withSkillScore != null
                      ? `${ev.baselineScore} → ${ev.withSkillScore} (+${ev.uplift ?? 0})`
                      : ev.error ?? "Pending"}
                  </span>
                </button>
                {open && results?.length ? (
                  <div className="space-y-1 border-t px-2 py-2">
                    {results.map((scenario) => (
                      <div
                        key={scenario.name}
                        className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 text-xs"
                      >
                        <span className="font-medium">{scenario.name}</span>
                        <span className="font-mono">
                          {scenario.baselineScore} → {scenario.withSkillScore}{" "}
                          ({scenario.uplift >= 0 ? "+" : ""}
                          {scenario.uplift})
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="text-muted-foreground">No eval runs yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
