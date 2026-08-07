import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type ObservabilitySummary,
} from "@skillist/ui";

type HarnessRow = ObservabilitySummary["telemetry"]["byHarness"][number];

/**
 * Display names for the harness ids the CLI infers from the path it wrote to
 * (`packages/cli/src/source.ts`). An id we don't recognize is shown verbatim
 * rather than dropped — a new harness should appear the day it reports, not the
 * day this map is updated.
 */
const HARNESS_LABELS: Record<string, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  gemini: "Gemini",
  vscode: "VS Code",
  agents: ".agents",
  unknown: "Unidentified",
};

export function harnessLabel(harness: string): string {
  return HARNESS_LABELS[harness] ?? harness;
}

/** "3 project · 1 user", omitting a scope with no events. */
export function scopeSummary(row: HarnessRow): string {
  const parts: string[] = [];
  if (row.projectScoped > 0) parts.push(`${row.projectScoped} project`);
  if (row.userScoped > 0) parts.push(`${row.userScoped} user`);
  return parts.join(" · ");
}

export function HarnessDelivery({ rows, days }: { rows?: HarnessRow[]; days: number }) {
  // Tolerate a response without `byHarness`. The console and the API deploy
  // independently, so a field added to a shared type is not guaranteed present
  // at runtime — during a rollout, after a rollback, or from a cached response.
  // Reading it unguarded took the whole Observability route down once already;
  // one optional panel must never be able to do that.
  const safeRows = rows ?? [];
  // Share of the busiest harness, so the bars compare against each other rather
  // than against an absolute that means nothing at this scale.
  const peak = Math.max(...safeRows.map((r) => r.activations), 1);

  return (
    <Card size="sm" id="harness-delivery">
      <CardHeader>
        <CardTitle>Delivery by harness</CardTitle>
        <CardDescription>
          Where this org's skills are materialized — last {days} days
        </CardDescription>
      </CardHeader>
      <CardContent>
        {safeRows.length === 0 ? (
          <HarnessDeliveryEmpty />
        ) : (
          <ul className="border-t border-border">
            {safeRows.map((row) => (
              <li
                key={row.harness}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {harnessLabel(row.harness)}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
                    {row.skills} {row.skills === 1 ? "skill" : "skills"} · {row.activations}{" "}
                    {row.activations === 1 ? "delivery" : "deliveries"}
                    {scopeSummary(row) ? ` · ${scopeSummary(row)}` : ""}
                  </p>
                </div>
                {/* Decorative: every value it encodes is already in the text
                    above, so it is hidden from assistive tech rather than
                    duplicated as a second announcement. */}
                <div aria-hidden="true" className="h-1 w-full max-w-40 shrink-0 bg-border sm:w-40">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.max((row.activations / peak) * 100, 4)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function HarnessDeliveryEmpty() {
  return (
    <div className="border-t border-border py-8 text-center">
      <p className="text-sm font-medium text-foreground">No deliveries reported yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Run <code className="font-mono text-foreground">skillist sync</code> in a project to
        materialize this org's skills into its agent harnesses. Each delivery reports the harness it
        landed in, and they show up here.
      </p>
    </div>
  );
}
