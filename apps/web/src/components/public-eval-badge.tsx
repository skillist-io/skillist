import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";

type PublicEval = {
  status: string;
  uplift: number | null;
  baselineScore: number | null;
  withSkillScore: number | null;
  completedAt: string | null;
};

export function PublicEvalBadge({ eval: evalData }: { eval: PublicEval | null | undefined }) {
  if (!evalData || evalData.status !== "completed" || evalData.uplift == null) {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <TrendingUp className="h-3 w-3" />
        No eval yet
      </Badge>
    );
  }

  const positive = evalData.uplift >= 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={positive ? "default" : "secondary"} className="gap-1">
        <TrendingUp className="h-3 w-3" />
        Eval uplift {evalData.uplift > 0 ? "+" : ""}
        {evalData.uplift}
      </Badge>
      {evalData.baselineScore != null && evalData.withSkillScore != null && (
        <span className="text-sm text-muted-foreground">
          {evalData.baselineScore} → {evalData.withSkillScore}
        </span>
      )}
    </div>
  );
}
