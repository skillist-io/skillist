import { AlertTriangle, Check, Info, X } from "lucide-react";
import { dismissStatus, type StatusKind, useStatusMessages } from "../lib/status";
import { cn } from "../utils";

const ICONS = { success: Check, error: AlertTriangle, info: Info } as const;

// Spoken and shown, so a result never depends on the icon or on red alone.
const LABELS: Record<StatusKind, string> = {
  success: "Done",
  error: "Failed",
  info: "Note",
};

/**
 * Where action outcomes appear. Mount once at the app shell.
 *
 * The live region stays mounted while empty because screen readers only
 * announce changes to a region they already know about. It sits above the
 * bottom edge so it clears page header actions, including Publish, and the
 * consent banner's buttons, which can take up to about a fifth of the height.
 */
export function StatusRegion() {
  const messages = useStatusMessages();

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-28 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {messages.map((message) => {
        const Icon = ICONS[message.kind];
        return (
          <div
            key={message.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 bg-card p-3 text-sm text-foreground shadow-sm ring-1",
              message.kind === "error" ? "ring-destructive/50" : "ring-foreground/15",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                message.kind === "error" ? "text-destructive" : "text-muted-foreground",
              )}
              aria-hidden
            />
            <p className="min-w-0 flex-1 break-words">
              <span className="font-medium">{LABELS[message.kind]}.</span> {message.text}
            </p>
            <button
              type="button"
              onClick={() => dismissStatus(message.id)}
              aria-label="Dismiss"
              className="shrink-0 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
