import { Shield, Sparkles, TrendingUp } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";

export function ScoreBadges({
  quality,
  impact,
  security,
}: {
  quality: number | null | undefined;
  impact: number | null | undefined;
  security: string | null | undefined;
}) {
  if (quality == null && impact == null && !security) return null;

  const securityVariant =
    security === "pass"
      ? "default"
      : security === "advisory"
        ? "secondary"
        : security === "fail"
          ? "destructive"
          : "outline";

  return (
    <div className="flex flex-wrap gap-1.5">
      {quality != null && (
        <Badge variant="outline" className="gap-1">
          <Sparkles className="h-3 w-3" />
          Quality {quality}
        </Badge>
      )}
      {impact != null && (
        <Badge variant="outline" className="gap-1">
          <TrendingUp className="h-3 w-3" />
          Impact {impact}
        </Badge>
      )}
      {security && (
        <Badge variant={securityVariant} className="gap-1">
          <Shield className="h-3 w-3" />
          {security}
        </Badge>
      )}
    </div>
  );
}

export function InstallSnippet({ command, prefix }: { command: string; prefix?: string }) {
  return (
    <div className="space-y-1">
      {prefix && <p className="text-xs text-muted-foreground">{prefix}</p>}
      <div className="flex items-start gap-2">
        <code className="block flex-1 rounded-none bg-muted px-2 py-1 text-xs">{command}</code>
        <CopyButton value={command} label="Copy" size="xs" className="shrink-0" />
      </div>
    </div>
  );
}
