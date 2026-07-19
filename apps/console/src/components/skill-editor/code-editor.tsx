import { cn, highlight, languageForPath } from "@skillist/ui";
import { useImperativeHandle, useMemo, useRef, useState } from "react";

export type CodeEditorHandle = {
  focusLine: (line: number) => void;
};

// The textarea and the highlight mirror must share identical font metrics —
// same class, same padding — or the caret drifts off the painted text.
const SURFACE_CLASSES = "font-mono text-xs leading-5 whitespace-pre p-3 pr-8";

export function CodeEditor({
  path,
  value,
  onChange,
  errorLines,
  readOnly,
  ref,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
  errorLines?: Set<number>;
  readOnly?: boolean;
  ref?: React.Ref<CodeEditorHandle>;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [escapePressed, setEscapePressed] = useState(false);

  const lineCount = useMemo(() => value.split("\n").length, [value]);
  const highlighted = useMemo(() => highlight(value, languageForPath(path)), [value, path]);

  useImperativeHandle(ref, () => ({
    focusLine: (line: number) => {
      const textarea = textareaRef.current;
      const scroller = scrollerRef.current;
      if (!textarea || !scroller) return;
      const lines = textarea.value.split("\n");
      const offset =
        lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0) +
        (lines[line - 1]?.length ?? 0);
      textarea.focus();
      textarea.setSelectionRange(offset, offset);
      const lineHeight = 20; // matches leading-5
      scroller.scrollTop = Math.max(0, (line - 1) * lineHeight - scroller.clientHeight / 2);
    },
  }));

  const insertText = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // execCommand keeps the native undo stack intact where supported.
    const inserted = document.execCommand?.("insertText", false, text);
    if (!inserted) {
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, "end");
      onChange(textarea.value);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      setEscapePressed(true);
      return;
    }
    if (event.key === "Tab" && !escapePressed) {
      event.preventDefault();
      if (!event.shiftKey) insertText("  ");
      return;
    }
    setEscapePressed(false);
  };

  return (
    <div
      ref={scrollerRef}
      className="max-h-[560px] overflow-auto rounded-none border border-border bg-background"
    >
      <div className="flex w-max min-w-full">
        <div
          aria-hidden
          className="sticky left-0 z-10 shrink-0 select-none border-r border-border bg-background py-3 text-right font-mono text-xs leading-5 text-muted-foreground"
        >
          {Array.from({ length: lineCount }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: row N is line N — the index is the identity
            <div key={`ln-${index + 1}`} className="relative px-3">
              {errorLines?.has(index + 1) && (
                <span
                  className="absolute top-1.5 left-1 size-1.5 bg-destructive"
                  title="Spec error on this line"
                />
              )}
              {index + 1}
            </div>
          ))}
        </div>
        <div className="relative flex-1">
          <pre
            aria-hidden
            className={cn(SURFACE_CLASSES, "pointer-events-none m-0 text-foreground")}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: output of our own escaping tokenizer
            dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }}
          />
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            readOnly={readOnly}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={`${path} source`}
            className={cn(
              SURFACE_CLASSES,
              "absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-foreground outline-none selection:bg-foreground/15 selection:text-transparent",
            )}
          />
        </div>
      </div>
    </div>
  );
}
