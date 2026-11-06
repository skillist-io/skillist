import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@skillist/ui";
import { Ban, CircleCheck, CircleSlash, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { toolAttempt, toolLabel } from "./tool-label";
import type { ToolOutcome } from "./tool-outcome";

function title(toolName: string, input: unknown, outcome: ToolOutcome): string {
  switch (outcome.kind) {
    case "running":
      return toolLabel(toolName, input, false);
    case "done":
      return toolLabel(toolName, input, true);
    case "awaiting":
      return `Awaiting approval: ${toolAttempt(toolName, input)}`;
    case "denied":
      return `Denied: ${toolAttempt(toolName, input)}`;
    case "refused":
      return `Refused: ${toolAttempt(toolName, input)} (${outcome.reason})`;
    case "failed":
      return `Failed: ${toolAttempt(toolName, input)}`;
  }
}

/** Status is never color alone: the title says it in words, and each kind has its own icon. */
function OutcomeIcon({ outcome }: { outcome: ToolOutcome }) {
  switch (outcome.kind) {
    case "running":
      return <Loader2 className="animate-spin motion-reduce:animate-none" />;
    case "done":
      return <CircleCheck className="text-foreground" />;
    case "awaiting":
      return <ShieldCheck />;
    case "denied":
      return <CircleSlash />;
    case "refused":
      return <Ban />;
    case "failed":
      return <TriangleAlert />;
  }
}

const LINE_STATUS = {
  running: "running",
  done: undefined,
  awaiting: "attention",
  // A person's "no" is a decision, and red is for things that broke.
  denied: undefined,
  refused: "error",
  failed: "error",
} as const;

function Payload({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span>{label}</span>
      <pre className="max-h-64 overflow-auto border border-border bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap text-foreground">
        {text}
      </pre>
    </div>
  );
}

/**
 * One tool call as a Trace step: a status line that opens onto what went in and
 * what came back, so an answer can be checked against the data behind it. A
 * failure repeats its full error at the top, because the line truncates.
 */
export function ToolCallRow({
  toolName,
  input,
  output,
  errorText,
  outcome,
}: {
  toolName: string;
  input: unknown;
  output: unknown;
  errorText?: string;
  outcome: ToolOutcome;
}) {
  const hasInput = input && typeof input === "object" && Object.keys(input).length > 0;
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={LINE_STATUS[outcome.kind]}>
            <TraceIcon>
              <OutcomeIcon outcome={outcome} />
            </TraceIcon>
            <TraceTitle>{title(toolName, input, outcome)}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          {outcome.kind === "failed" && (
            <p className="font-mono text-destructive">
              {outcome.reason || "The tool failed without giving a reason."}
            </p>
          )}
          {outcome.kind === "refused" && (
            <p className="font-mono text-destructive">Refused: {outcome.reason}</p>
          )}
          <p className="font-mono">{toolName}</p>
          {hasInput ? <Payload label="Input" value={input} /> : null}
          <Payload label="Result" value={output} />
          {errorText && outcome.kind !== "failed" ? (
            <Payload label="Error" value={errorText} />
          ) : null}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** Consecutive successful reads, folded so the reply stays the focus. */
export function ToolCallGroup({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <CircleCheck className="text-foreground" />
            </TraceIcon>
            <TraceTitle>Ran {count} checks</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>{children}</TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
