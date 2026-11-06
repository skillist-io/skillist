import { getToolInput, getToolPartState } from "@cloudflare/ai-chat/react";
import { cn } from "@skillist/ui";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { Streamdown } from "streamdown";
import { contextChip, splitContext } from "@/lib/agent-context";
import { ApprovalCard, type ApprovalHandlers } from "./approval-card";
import { BranchSelector } from "./branch-selector";
import { MessageActions } from "./message-actions";
import { ToolCallGroup, ToolCallRow } from "./tool-call-row";
import { WRITE_TOOLS } from "./tool-label";
import { type ToolOutcome, toolOutcome } from "./tool-outcome";

type ToolStep = {
  key: string;
  toolName: string;
  input: unknown;
  output: unknown;
  errorText?: string;
  outcome: ToolOutcome;
};

type Block =
  | { type: "text"; key: string; text: string }
  | { type: "tool"; key: string; step: ToolStep }
  | { type: "group"; key: string; steps: ToolStep[] };

/**
 * Turn message parts into render blocks. Runs of successful reads fold into one
 * group; anything that failed, waits on a person, or changed something stays out
 * in the open.
 */
function toBlocks(message: UIMessage): Block[] {
  const blocks: Block[] = [];
  let run: ToolStep[] = [];

  const flush = () => {
    const [first] = run;
    if (run.length === 1 && first) blocks.push({ type: "tool", key: first.key, step: first });
    else if (first) blocks.push({ type: "group", key: first.key, steps: run });
    run = [];
  };

  (message.parts ?? []).forEach((part, i) => {
    const key = `${message.id}-${i}`;
    if (part.type === "text") {
      if (!part.text.trim()) return;
      flush();
      blocks.push({ type: "text", key, text: part.text });
    } else if (isToolUIPart(part)) {
      const output = "output" in part ? part.output : undefined;
      const errorText = "errorText" in part ? part.errorText : undefined;
      const called = getToolName(part);
      // An approved run reports what it ran, so the line can name that action rather
      // than saying an unnamed one happened.
      const ran = called === "run_approved_action" ? field(output, "ran") : undefined;
      const ranName = field(ran, "toolName");
      const toolName = typeof ranName === "string" ? ranName : called;
      const step: ToolStep = {
        key,
        toolName,
        input: ranName ? field(ran, "args") : getToolInput(part),
        output,
        errorText,
        outcome: toolOutcome(getToolPartState(part), output, errorText),
      };
      if (step.outcome.kind === "done" && !WRITE_TOOLS.has(toolName)) {
        run.push(step);
      } else {
        flush();
        blocks.push({ type: "tool", key, step });
      }
    }
  });
  flush();
  return blocks;
}

/** Whether a reply wrote something, or stopped for a decision. Re-running it isn't free. */
export function touchesState(message: UIMessage): boolean {
  return (message.parts ?? []).some(
    (part) => isToolUIPart(part) && WRITE_TOOLS.has(getToolName(part)),
  );
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** One rendered turn: user prompt (right, squared block) or agent reply (left,
 *  markdown + inline tool-call status rows). Prose is never mono; machine
 *  status rows are. Assistant replies carry copy/regenerate actions and, when
 *  the reply has regenerated variants, a `‹ n / N ›` cycler. */
export function AgentMessage({
  message,
  onRegenerate,
  branchIndex = 0,
  branchTotal = 0,
  onPrevVariant,
  onNextVariant,
  approvals,
  streaming = false,
}: {
  message: UIMessage;
  /** Present on assistant messages whose preceding user turn can be regenerated. */
  onRegenerate?: () => void;
  branchIndex?: number;
  branchTotal?: number;
  onPrevVariant?: () => void;
  onNextVariant?: () => void;
  /** Lets a gated tool call render its decision card. */
  approvals?: ApprovalHandlers;
  /** This reply is still arriving, so it has nothing final to copy yet. */
  streaming?: boolean;
}) {
  const isUser = message.role === "user";
  const parts = message.parts ?? [];

  if (isUser) {
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => ("text" in p ? p.text : ""))
      .join("");
    // The page context travels inside the message, so show it as a readout
    // above the prompt rather than as a raw line the user has to parse.
    const { context, body } = splitContext(text);
    // An approval is the person's own click, and the "Run it" text under it is the
    // instruction to the agent. The line stays, with the id, but isn't dressed up as
    // something they typed.
    if (context?.startsWith("id: ")) {
      return (
        <div className="flex justify-end" data-role="user">
          <span className="font-mono text-xs text-muted-foreground">
            {contextChip(context)} · approved by you
          </span>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-end gap-1" data-role="user">
        {context && (
          <span className="max-w-[min(85%,60ch)] truncate font-mono text-xs text-muted-foreground">
            {contextChip(context)}
          </span>
        )}
        <div className="max-w-[min(85%,60ch)] border border-border bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
          {body}
        </div>
      </div>
    );
  }

  // The runtime opens a message before it has anything in it. Nothing to show means
  // no label and no actions either; the transcript speaks for a turn that stays empty.
  const blocks = toBlocks(message);
  if (blocks.length === 0) return null;

  return (
    <div className="group/msg flex flex-col gap-2" data-role="assistant">
      <div className="text-xs font-semibold text-muted-foreground">Agent</div>
      <div className="flex flex-col gap-2">
        {blocks.map((block) => {
          if (block.type === "text") {
            return (
              <Streamdown
                key={block.key}
                className={cn(
                  "prose prose-neutral prose-sm dark:prose-invert max-w-[62ch]",
                  "prose-pre:rounded-none prose-pre:border prose-pre:border-border",
                  "prose-code:before:content-none prose-code:after:content-none",
                )}
              >
                {block.text}
              </Streamdown>
            );
          }

          if (block.type === "group") {
            return (
              <ToolCallGroup key={block.key} count={block.steps.length}>
                {block.steps.map(({ key, ...step }) => (
                  <ToolCallRow key={key} {...step} />
                ))}
              </ToolCallGroup>
            );
          }

          const { key, ...step } = block.step;
          if (step.outcome.kind === "awaiting" && step.outcome.approvalId && approvals) {
            return (
              <ApprovalCard
                key={key}
                approvalId={step.outcome.approvalId}
                toolName={step.toolName}
                input={step.input}
                handlers={approvals}
              />
            );
          }
          return <ToolCallRow key={key} {...step} />;
        })}
      </div>
      {!streaming && (
        <MessageActions message={message} onRegenerate={onRegenerate}>
          <BranchSelector
            index={branchIndex}
            total={branchTotal}
            onPrev={() => onPrevVariant?.()}
            onNext={() => onNextVariant?.()}
          />
        </MessageActions>
      )}
    </div>
  );
}
