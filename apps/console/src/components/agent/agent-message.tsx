import { getToolInput, getToolPartState } from "@cloudflare/ai-chat/react";
import { cn } from "@skillist/ui";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { Streamdown } from "streamdown";
import { ToolCallRow } from "./tool-call-row";

/** One rendered turn: user prompt (right, squared block) or agent reply (left,
 *  markdown + inline tool-call status rows). Prose is never mono; machine
 *  status rows are. */
export function AgentMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const parts = message.parts ?? [];

  if (isUser) {
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => ("text" in p ? p.text : ""))
      .join("");
    return (
      <div className="flex justify-end" data-role="user">
        <div className="max-w-[min(85%,60ch)] border border-border bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-role="assistant">
      <div className="text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
        Agent
      </div>
      <div className="flex flex-col gap-2">
        {parts.map((part, i) => {
          const key = `${message.id}-${i}`;

          if (part.type === "text" && part.text.trim()) {
            return (
              <Streamdown
                key={key}
                className={cn(
                  "prose prose-neutral prose-sm dark:prose-invert max-w-none",
                  "prose-pre:rounded-none prose-pre:border prose-pre:border-border",
                  "prose-code:before:content-none prose-code:after:content-none",
                )}
              >
                {part.text}
              </Streamdown>
            );
          }

          if (isToolUIPart(part)) {
            return (
              <ToolCallRow
                key={key}
                toolName={getToolName(part)}
                input={getToolInput(part)}
                state={getToolPartState(part)}
              />
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
