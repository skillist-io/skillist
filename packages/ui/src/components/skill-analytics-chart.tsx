import { useQuery } from "@tanstack/react-query";
import { api, Card, CardContent, CardDescription, CardHeader, CardTitle } from "..";
import { MiniBarChart } from "./mini-bar-chart";

type SkillAnalyticsChartProps = {
  org: string;
  repo: string;
};

export function SkillAnalyticsChart({ org, repo }: SkillAnalyticsChartProps) {
  const { data } = useQuery({
    queryKey: ["registry-analytics", org, repo],
    queryFn: () =>
      api<{
        installs: number;
        activations: number;
        series: {
          installs: { date: string; count: number }[];
          activations: { date: string; count: number }[];
        };
      }>(`/v1/registry/${org}/${repo}/analytics?days=30`),
  });

  if (!data?.series?.installs || !data.series.activations) return null;

  // A brand-new skill returns a full 30-point series of zeroes. Rendering that
  // as two empty plot areas reads as a broken chart, so say what's true instead.
  const total = [...data.series.installs, ...data.series.activations].reduce(
    (sum, point) => sum + point.count,
    0,
  );

  if (total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage (30 days)</CardTitle>
          <CardDescription>No installs or activations yet</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Usage appears here once agents install and activate this skill.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage (30 days)</CardTitle>
        <CardDescription>
          {data.installs} installs · {data.activations} activations
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Installs</p>
          <MiniBarChart
            data={data.series.installs.map((p) => ({
              label: p.date,
              value: p.count,
            }))}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Activations</p>
          <MiniBarChart
            data={data.series.activations.map((p) => ({
              label: p.date,
              value: p.count,
            }))}
          />
        </div>
      </CardContent>
    </Card>
  );
}
