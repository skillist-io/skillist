import {
  Button,
  cn,
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@skillist/ui";
import { ArrowUp, Plus, Square, X } from "lucide-react";
import { type Ref, useId, useRef } from "react";
import { type AgentContext, describeContext, formatContext } from "@/lib/agent-context";
import { type ConnState, composerReadout } from "./composer-readout";

/**
 * Where a question gets written. Built on the AI Elements Prompt Input structure:
 * attachments above the field, a toolbar below it, and Enter going through
 * `requestSubmit` so the key and the button share one path.
 *
 * What upstream doesn't cover, and this has to: Enter confirming an IME candidate
 * must never send, and Send and Stop must stay distinct elements. Sharing one node
 * meant a keypress aimed at Stop could land on Send as a turn ended.
 */
export function Composer({
  ref,
  orgName,
  value,
  onChange,
  onSubmit,
  onStop,
  connState,
  terminal,
  busy,
  held,
  context,
  contextAttached,
  onToggleContext,
  className,
}: {
  ref: Ref<HTMLTextAreaElement>;
  orgName: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  connState: ConnState;
  terminal: boolean;
  busy: boolean;
  held: boolean;
  context?: AgentContext;
  contextAttached: boolean;
  onToggleContext: () => void;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const readoutId = useId();
  const contextId = useId();
  const canSend = connState === "connected" && !busy && value.trim().length > 0;

  return (
    <form
      ref={formRef}
      className={cn("mx-auto w-full px-4 pt-2 pb-3", className)}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <InputGroup>
        {context && (
          <InputGroupAddon align="block-start">
            <span>Context</span>
            <ContextToggle
              context={context}
              attached={contextAttached}
              onToggle={onToggleContext}
            />
            <span id={contextId} className="sr-only">
              {contextAttached
                ? `Attached context: ${describeContext(context)}`
                : "No page context attached"}
            </span>
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={ref}
          data-agent-composer
          // Read by the drawer: while a reply streams, Esc stops it rather than closing.
          data-agent-busy={busy || undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // First, always: Enter here is confirming a candidate, not sending.
            // 229 covers browsers that end composition before this event fires.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Escape" && busy) {
              e.preventDefault();
              onStop();
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          rows={1}
          placeholder={`Ask the ${orgName} agent…`}
          aria-label={`Message the ${orgName} agent`}
          aria-describedby={context ? `${readoutId} ${contextId}` : readoutId}
          className="max-h-[min(10rem,35dvh)] min-h-10"
        />
        <InputGroupAddon align="block-end" className="justify-between">
          <span id={readoutId} className="min-w-0 truncate font-mono">
            {composerReadout({ connState, terminal, busy, held, text: value })}
          </span>
          <span className="sr-only" aria-live="polite">
            {held ? "Your message is held until the reply ends." : ""}
          </span>
          {busy ? (
            <Button
              key="stop"
              type="button"
              variant="outline"
              size="icon"
              onClick={onStop}
              aria-label="Stop generating"
              className="shrink-0 pointer-coarse:size-11"
            >
              <Square className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button
              key="send"
              type="submit"
              // Empty reads as a quiet outline. Not `disabled`: that would drop
              // keyboard focus off the control the moment a turn ended.
              variant={canSend ? "default" : "outline"}
              size="icon"
              aria-disabled={!canSend}
              aria-label="Send message"
              className={cn("shrink-0 pointer-coarse:size-11", !canSend && "text-muted-foreground")}
            >
              <ArrowUp className="size-4" aria-hidden />
            </Button>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

/** One stable control, so toggling keeps focus. The tooltip shows the literal line sent. */
function ContextToggle({
  context,
  attached,
  onToggle,
}: {
  context: AgentContext;
  attached: boolean;
  onToggle: () => void;
}) {
  const Icon = attached ? X : Plus;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={attached}
          aria-label={`Attach page context: ${describeContext(context)}`}
          onClick={onToggle}
          className={cn(
            "flex min-h-6 min-w-0 cursor-pointer items-center gap-1.5 border px-2 font-mono text-xs transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            attached
              ? "border-border text-foreground"
              : "border-dashed border-border text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="min-w-0 truncate">{describeContext(context)}</span>
          <Icon className="size-3 shrink-0" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm font-mono text-xs break-all">
        {attached
          ? `Sent with your message: ${formatContext(context)}`
          : "Not attached. The agent won't know which page you're on."}
      </TooltipContent>
    </Tooltip>
  );
}
