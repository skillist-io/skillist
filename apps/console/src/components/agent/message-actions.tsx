import { Button, cn } from "@skillist/ui";
import type { UIMessage } from "ai";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Flatten a message's text parts for the clipboard. */
function messageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => ("text" in p ? p.text : ""))
    .join("\n")
    .trim();
}

/**
 * Copy + regenerate controls under an assistant reply. Always rendered (not
 * hover-only) so keyboard users reach them; kept low-emphasis until focus or
 * hover. Copy confirms with a transient icon swap announced to screen readers.
 */
export function MessageActions({
  message,
  onRegenerate,
  children,
  className,
}: {
  message: UIMessage;
  /** Regenerate the reply to the preceding user message. */
  onRegenerate?: () => void;
  /** Slot for the variant cycler, laid out inline with the buttons. */
  children?: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = useCallback(async () => {
    const text = messageText(message);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setCopyFailed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopyFailed(false), 3000);
      return;
    }
    setCopyFailed(false);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [message]);

  return (
    <div className={cn("flex items-center gap-0.5 text-muted-foreground", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={copy}
        aria-label={copied ? "Copied to clipboard" : "Copy response"}
        className="size-6 pointer-coarse:size-11"
      >
        {copied ? (
          <Check className="size-3.5 text-foreground" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </Button>
      {onRegenerate && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRegenerate}
          aria-label="Regenerate response"
          className="size-6 pointer-coarse:size-11"
        >
          <RefreshCw className="size-3.5" aria-hidden />
        </Button>
      )}
      {children}
      {copyFailed && <span className="ml-1 text-xs">Couldn't copy</span>}
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : copyFailed ? "Couldn't copy" : ""}
      </span>
    </div>
  );
}
