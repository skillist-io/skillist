import { Shield, Sparkles, TrendingUp } from "lucide-react";
import { cn, Tooltip, TooltipContent, TooltipTrigger } from "..";

const SCORE_HELP = {
  quality: "Quality (0-100): automated review of SKILL.md structure, clarity, and completeness.",
  impact:
    "Impact (0-100): measured uplift an agent gains when this skill is active, from eval runs.",
  security: "Security: result of the latest static scan of the skill's scripts and manifest.",
} as const;

type ScoreReadoutProps = {
  quality?: number | null;
  impact?: number | null;
  security?: string | null;
  className?: string;
};

/**
 * Compact monochrome score readout: Quality / Impact numbers plus a Security
 * status word. Each is a focusable trigger that reveals a plain-language
 * definition, so the meaning is reachable by mouse, keyboard, and touch.
 * Requires a TooltipProvider ancestor.
 */
export function ScoreReadout({ quality, impact, security, className }: ScoreReadoutProps) {
  if (quality == null && impact == null && !security) return null;

  const securityTone =
    security === "fail"
      ? "text-destructive"
      : security === "advisory"
        ? "text-muted-foreground"
        : "text-foreground";

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-xs", className)}
    >
      {quality != null && (
        <ScoreChip
          icon={<Sparkles className="size-3.5" aria-hidden />}
          label="Quality"
          value={quality}
          help={SCORE_HELP.quality}
        />
      )}
      {impact != null && (
        <ScoreChip
          icon={<TrendingUp className="size-3.5" aria-hidden />}
          label="Impact"
          value={impact}
          help={SCORE_HELP.impact}
        />
      )}
      {security && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex cursor-help items-center gap-1.5 rounded-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
                securityTone,
              )}
            >
              <Shield className="size-3.5" aria-hidden />
              <span className="tracking-wide uppercase">{security}</span>
              <span className="sr-only">security status, tap for details</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{SCORE_HELP.security}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function ScoreChip({
  icon,
  label,
  value,
  help,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  help: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex cursor-help items-center gap-1.5 rounded-none text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {icon}
          <span className="tracking-wide text-muted-foreground uppercase">{label}</span>
          <span className="tabular-nums">{value}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{help}</TooltipContent>
    </Tooltip>
  );
}
