import { cn } from "@skillist/ui";
import { CircleCheck, CircleSlash, Loader2, TriangleAlert, Wrench } from "lucide-react";
import { toolLabel } from "./tool-label";

/** Simplified tool-part lifecycle, mirrored from `getToolPartState`. */
export type ToolState =
  | "loading"
  | "streaming"
  | "waiting-approval"
  | "approved"
  | "complete"
  | "error"
  | "denied";

export function ToolCallRow({
  toolName,
  input,
  state,
}: {
  toolName: string;
  input: unknown;
  state: ToolState;
}) {
  const done = state === "complete" || state === "approved";
  const failed = state === "error" || state === "denied";
  const label = toolLabel(toolName, input, done || failed);

  // Status is never encoded by color alone — each state carries a distinct
  // icon shape and an accessible label.
  const Icon = failed
    ? state === "denied"
      ? CircleSlash
      : TriangleAlert
    : done
      ? CircleCheck
      : state === "waiting-approval"
        ? Wrench
        : Loader2;
  const spinning = !done && !failed && state !== "waiting-approval";
  const statusWord = failed
    ? state === "denied"
      ? "Denied"
      : "Failed"
    : done
      ? "Done"
      : "Running";

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-l-2 py-1 pl-2.5 font-mono text-xs",
        failed ? "border-l-destructive text-destructive" : "border-l-border text-muted-foreground",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0",
          spinning && "animate-spin motion-reduce:animate-none",
          done && "text-foreground",
        )}
      />
      <span className="truncate">{label}</span>
      <span className="sr-only"> ({statusWord})</span>
    </div>
  );
}
