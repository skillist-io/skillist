import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cn } from "..";

type CopyButtonProps = {
  value: string;
  label?: string;
  size?: "xs" | "sm" | "default";
  variant?: "outline" | "ghost" | "secondary";
  className?: string;
};

/**
 * Copies `value` to the clipboard and confirms with a transient Copied state.
 * The confirmation is announced for screen readers via aria-live.
 */
export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
  variant = "outline",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for non-secure contexts / older browsers.
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        // Give up silently; nothing to copy into.
      }
      document.body.removeChild(el);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [value]);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={copy}
      aria-label={copied ? "Copied to clipboard" : `${label}: ${value}`}
      data-copied={copied || undefined}
      className={cn("gap-1.5", className)}
    >
      {copied ? <Check className="text-foreground" aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
}
