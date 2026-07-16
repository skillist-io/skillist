import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MiniBarChart } from "@/components/mini-bar-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { api, type ObservabilitySummary, type Org } from "@/lib/api";
import { requireAuth } from "@/lib/require-auth";

export const Route = createFileRoute("/observability")({
  beforeLoad: () => requireAuth(),
  component: ObservabilityPage,
});

function MetricCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>
      ) : null}
    </Card>
  );
}

function ObservabilityPage() {
  const { data: orgs } = useQuery({
    queryKey: ["orgs"],
    queryFn: () => api<Org[]>("/v1/orgs"),
  });
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const activeOrgId = selectedOrgId || orgs?.[0]?.id || "";

  const { data } = useQuery({
    queryKey: ["observability", activeOrgId],
    queryFn: () => api<ObservabilitySummary>(`/v1/orgs/${activeOrgId}/observability?days=30`),
    enabled: !!activeOrgId,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Observability</h1>
        <p className="text-muted-foreground">Hosted runs, install funnel, and activation trends</p>
      </div>

      {orgs && orgs.length > 1 ? (
        <div className="max-w-xs space-y-2">
          <Label htmlFor="obs-org">Organization</Label>
          <select
            id="obs-org"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={activeOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
          >
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {data ? (
        <>
          <div id="run-metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Hosted runs (30d)"
              value={data.runs.total}
              hint={`${data.runs.succeeded} succeeded · ${data.runs.failed} failed`}
            />
            <MetricCard
              title="Run success rate"
              value={data.runs.successRate != null ? `${data.runs.successRate}%` : "—"}
              hint={
                data.runs.avgDurationMs
                  ? `Avg ${data.runs.avgDurationMs}ms`
                  : "No completed runs yet"
              }
            />
            <MetricCard
              title="Installs (30d)"
              value={data.telemetry.installs}
              hint={`${data.telemetry.events} total telemetry events`}
            />
            <MetricCard
              title="Activations (30d)"
              value={data.telemetry.activations}
              hint="CLI install → first use"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card id="run-metrics-chart">
              <CardHeader>
                <CardTitle>Run volume</CardTitle>
                <CardDescription>Daily hosted runs</CardDescription>
              </CardHeader>
              <CardContent>
                <MiniBarChart
                  data={data.series.runs.map((p) => ({
                    label: p.date,
                    value: p.count,
                  }))}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Install funnel trend</CardTitle>
                <CardDescription>Daily installs and activations</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">Installs</p>
                  <MiniBarChart
                    data={data.series.installs.map((p) => ({
                      label: p.date,
                      value: p.count,
                    }))}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">Activations</p>
                  <MiniBarChart
                    data={data.series.activations.map((p) => ({
                      label: p.date,
                      value: p.count,
                    }))}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Runs by runtime</CardTitle>
                <CardDescription>Last 30 days</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {Object.entries(data.runs.byRuntime).length ? (
                  Object.entries(data.runs.byRuntime).map(([runtime, count]) => (
                    <Badge key={runtime} variant="secondary">
                      {runtime}: {count}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No runs yet.</p>
                )}
              </CardContent>
            </Card>

            <Card id="install-funnel">
              <CardHeader>
                <CardTitle>Registry funnel</CardTitle>
                <CardDescription>Install vs activation by skill</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data.telemetry.bySkill.length ? (
                  data.telemetry.bySkill.map((row) => (
                    <div
                      key={row.skillRepo}
                      className="flex items-center justify-between rounded border px-2 py-1"
                    >
                      <span>{row.skillRepo}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.installCount} installs · {row.activationCount} activations
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">No public skills yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card id="recent-runs">
            <CardHeader>
              <CardTitle>Recent runs</CardTitle>
              <CardDescription>Latest hosted script executions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data.runs.recent.length ? (
                data.runs.recent.map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant={run.exitCode === 0 ? "default" : "destructive"}>
                        {run.status}
                      </Badge>
                      <span className="font-medium">{run.skillRepo}</span>
                      <span className="text-xs text-muted-foreground">{run.scriptPath}</span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {run.runtime}
                      {run.durationMs != null ? ` · ${run.durationMs}ms` : ""}
                      {run.exitCode != null ? ` · exit ${run.exitCode}` : ""}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">No runs recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-muted-foreground">Select an organization to view metrics.</p>
      )}
    </div>
  );
}
