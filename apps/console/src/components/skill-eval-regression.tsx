import type { SkillEval } from "@skillist/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  MiniBarChart,
} from "@skillist/ui";
import { useMemo } from "react";

type SkillEvalRegressionProps = {
  evals: SkillEval[];
};

export function SkillEvalRegression({ evals }: SkillEvalRegressionProps) {
  const completed = useMemo(
    () =>
      [...evals]
        .filter((ev) => ev.status === "completed" && ev.uplift != null)
        .reverse()
        .slice(-12),
    [evals],
  );

  const chartData = completed.map((ev) => ({
    label: ev.semver ? `v${ev.semver}` : ev.id.slice(0, 6),
    value: ev.uplift ?? 0,
  }));

  if (!completed.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Eval regression</CardTitle>
          <CardDescription>Uplift trend across versions</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Run evals on multiple versions to track uplift over time.
          </p>
        </CardContent>
      </Card>
    );
  }

  const latest = completed[completed.length - 1]!;
  const previous = completed[completed.length - 2];
  const delta =
    previous?.uplift != null && latest.uplift != null ? latest.uplift - previous.uplift : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Eval regression</CardTitle>
        <CardDescription>
          Uplift by version
          {delta != null && (
            <span className="ml-2 font-mono text-xs">
              Δ {delta >= 0 ? "+" : ""}
              {delta} vs prior
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MiniBarChart data={chartData} valueLabel="uplift" className="max-w-full" />
        <div className="space-y-1 text-xs">
          {completed
            .slice()
            .reverse()
            .map((ev) => (
              <div
                key={ev.id}
                className="flex items-center justify-between border border-border px-2 py-1"
              >
                <span>{ev.semver ? `v${ev.semver}` : ev.versionId?.slice(0, 8)}</span>
                <span className="font-mono text-muted-foreground">
                  {ev.baselineScore} → {ev.withSkillScore} (+{ev.uplift})
                </span>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
