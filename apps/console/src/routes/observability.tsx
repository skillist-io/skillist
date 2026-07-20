import {
  api,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  type FailurePattern,
  Label,
  MiniBarChart,
  NativeSelect,
  type ObservabilitySummary,
  PageTitle,
  SegmentedControl,
  Skeleton,
} from "@skillist/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, FilePen, Minus } from "lucide-react";
import { useState } from "react";
import { useActiveOrg } from "@/lib/active-org";
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
    <Card size="sm" className="flex flex-col">
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent className="mt-auto pt-0 text-xs text-muted-foreground">{hint}</CardContent>
      ) : null}
    </Card>
  );
}

/** The API accepts 1-90 days; these are the windows worth one click. */
const RANGE_OPTIONS = [
  { value: 7, label: "7d", srLabel: "Last 7 days" },
  { value: 30, label: "30d", srLabel: "Last 30 days" },
  { value: 90, label: "90d", srLabel: "Last 90 days" },
] as const;

function ObservabilityPage() {
  const { activeOrg } = useActiveOrg();
  const activeOrgId = activeOrg?.id ?? "";
  const [days, setDays] = useState<number>(30);

  const { data, isPlaceholderData } = useQuery({
    queryKey: ["observability", activeOrgId, days],
    queryFn: () => api<ObservabilitySummary>(`/v1/orgs/${activeOrgId}/observability?days=${days}`),
    enabled: !!activeOrgId,
    // Changing the window is a new key; hold the old numbers and dim rather
    // than blanking every readout on the page.
    placeholderData: keepPreviousData,
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle>Observability</PageTitle>
          <p className="text-muted-foreground">
            Hosted runs, install funnel, and activation trends
          </p>
        </div>
        <SegmentedControl label="Window" value={days} onChange={setDays} options={RANGE_OPTIONS} />
      </div>

      {data ? (
        <div
          className={cn(
            "space-y-8 transition-opacity duration-150",
            isPlaceholderData && "opacity-50",
          )}
          aria-busy={isPlaceholderData}
        >
          <div id="run-metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title={`Hosted runs (${days}d)`}
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
              title={`Installs (${days}d)`}
              value={data.telemetry.installs}
              hint={`${data.telemetry.events} total telemetry events`}
            />
            <MetricCard
              title={`Activations (${days}d)`}
              value={data.telemetry.activations}
              hint="CLI install → first use"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card size="sm" id="run-metrics-chart">
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

            <Card size="sm">
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
            <Card size="sm">
              <CardHeader>
                <CardTitle>Runs by runtime</CardTitle>
                <CardDescription>Last {days} days</CardDescription>
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

            <Card size="sm" id="install-funnel">
              <CardHeader>
                <CardTitle>Registry funnel</CardTitle>
                <CardDescription>Install vs activation by skill</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data.telemetry.bySkill.length ? (
                  data.telemetry.bySkill.map((row) => (
                    <div
                      key={row.skillRepo}
                      className="flex items-center justify-between border border-border px-2 py-1"
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

          <Card size="sm" id="recent-runs">
            <CardHeader>
              <CardTitle>Recent runs</CardTitle>
              <CardDescription>Latest hosted script executions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {data.runs.recent.length ? (
                data.runs.recent.map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-2 border border-border px-2 py-1"
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
        </div>
      ) : (
        <p className="text-muted-foreground">Select an organization to view metrics.</p>
      )}

      {activeOrgId ? <RecurringFailures orgId={activeOrgId} /> : null}
    </div>
  );
}

type FailureStatusFilter = "open" | "drafted" | "dismissed" | "all";

const FAILURE_FILTERS: { value: FailureStatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "drafted", label: "Drafted" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

function RecurringFailures({ orgId }: { orgId: string }) {
  const [filter, setFilter] = useState<FailureStatusFilter>("open");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["failure-patterns", orgId, filter],
    queryFn: () =>
      api<{ patterns: FailurePattern[] }>(
        filter === "all"
          ? `/v1/orgs/${orgId}/failure-patterns`
          : `/v1/orgs/${orgId}/failure-patterns?status=${filter}`,
      ),
    enabled: !!orgId,
  });

  const patterns = [...(data?.patterns ?? [])].sort((a, b) => b.occurrences - a.occurrences);

  return (
    <Card size="sm" id="recurring-failures">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Recurring failures</CardTitle>
          <CardDescription>
            Clustered skill-run and eval failures — surfaced most-frequent first
          </CardDescription>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="failure-filter" className="sr-only">
            Filter by status
          </Label>
          <NativeSelect
            id="failure-filter"
            className="w-40"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FailureStatusFilter)}
          >
            {FAILURE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <FailuresSkeleton />
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load recurring failures.</p>
        ) : patterns.length === 0 ? (
          <FailuresEmpty />
        ) : (
          <div className="border-t border-border">
            {patterns.map((pattern) => (
              <FailureRow key={pattern.id} orgId={orgId} pattern={pattern} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FailureRow({ orgId, pattern }: { orgId: string; pattern: FailurePattern }) {
  return (
    <div className="border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 truncate font-mono text-sm text-foreground">{pattern.skillRepo}</p>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            <span className="text-foreground">{pattern.occurrences}</span>{" "}
            {pattern.occurrences === 1 ? "occurrence" : "occurrences"}
          </span>
          <FailureStatus status={pattern.status} />
        </div>
      </div>

      <p className="mt-1.5 text-sm text-muted-foreground">{pattern.summary}</p>

      {pattern.status === "drafted" && pattern.feedbackId ? (
        <p className="mt-2">
          <Link
            to="/orgs/$orgId/skills/$repo"
            params={{ orgId, repo: pattern.skillRepo }}
            hash="feedback"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4 hover:text-foreground/70"
          >
            <FilePen className="size-3.5 shrink-0" aria-hidden />
            Improvement drafted — review in the feedback inbox
          </Link>
        </p>
      ) : null}

      {pattern.suggestedFix ? (
        <Collapsible className="mt-2">
          <CollapsibleTrigger className="group/fix inline-flex items-center gap-1 text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ChevronRight
              className="size-3 shrink-0 transition-transform group-data-[state=open]/fix:rotate-90 motion-reduce:transition-none"
              aria-hidden
            />
            Suggested fix
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 border-l-2 border-border pl-3 text-sm text-muted-foreground">
            {pattern.suggestedFix}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

/**
 * Status as icon + word (never color alone). `open` is an unaddressed recurring
 * failure → destructive red; `drafted` means an improvement is pending human
 * approval → neutral ink; `dismissed` is muted.
 */
function FailureStatus({ status }: { status: FailurePattern["status"] }) {
  const config = {
    open: { Icon: AlertTriangle, label: "Open", tone: "text-destructive" },
    drafted: { Icon: FilePen, label: "Drafted", tone: "text-foreground" },
    dismissed: { Icon: Minus, label: "Dismissed", tone: "text-muted-foreground" },
  }[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase",
        config.tone,
      )}
    >
      <config.Icon className="size-3.5 shrink-0" aria-hidden />
      {config.label}
    </span>
  );
}

function FailuresEmpty() {
  return (
    <div className="border-t border-border py-8 text-center">
      <p className="text-sm font-medium text-foreground">No recurring failures detected</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        The miner runs every few hours over failed skill runs and weak evals, clustering repeats and
        drafting an improvement once a pattern reaches three occurrences.
      </p>
    </div>
  );
}

function FailuresSkeleton() {
  return (
    <div
      className="border-t border-border"
      role="status"
      aria-busy="true"
      aria-label="Loading recurring failures"
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2 border-b border-border py-4 last:border-b-0">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
      ))}
    </div>
  );
}
