import type { ValidationError } from "@skillist/skill-format";
import { Check, CircleAlert } from "lucide-react";

export function ValidationPanel({
  errors,
  onFocusError,
}: {
  errors: ValidationError[];
  onFocusError?: (error: ValidationError) => void;
}) {
  if (errors.length === 0) {
    return (
      <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
        <Check className="size-3.5" aria-hidden />
        Bundle conforms to the agentskills.io spec.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border" aria-label="Spec validation errors">
      {errors.map((error) => (
        <li key={`${error.path}:${error.message}`}>
          <button
            type="button"
            onClick={() => onFocusError?.(error)}
            className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
          >
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
            <span className="min-w-0">
              <span className="font-mono font-medium">{error.path}</span>{" "}
              <span className="text-muted-foreground">{error.message}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
