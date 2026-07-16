import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MiniBarChart } from "@/components/mini-bar-chart";

type SkillAnalyticsChartProps = {
  org: string;
  slug: string;
};

export function SkillAnalyticsChart({ org, slug }: SkillAnalyticsChartProps) {
  const { data } = useQuery({
    queryKey: ["registry-analytics", org, slug],
    queryFn: () =>
      api<{
        installs: number;
        activations: number;
        series: {
          installs: { date: string; count: number }[];
          activations: { date: string; count: number }[];
        };
      }>(`/v1/registry/${org}/${slug}/analytics?days=30`),
  });

  if (!data) return null;

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
