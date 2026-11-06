import type { StopCondition, ToolSet } from "ai";

/**
 * End the turn once a tool is waiting on a person. The card already states what
 * would happen, and a model left to continue retells it underneath, which pushed
 * the card's buttons away from the words they decide. The prompt asked it to stop;
 * this doesn't rely on it listening.
 */
export const waitingOnPerson: StopCondition<ToolSet> = ({ steps }) =>
  (steps.at(-1)?.toolResults ?? []).some((result) => {
    const output: unknown = result.output;
    return (
      typeof output === "object" &&
      output !== null &&
      "status" in output &&
      output.status === "awaiting_approval"
    );
  });

const TITLE_LENGTH = 60;

/**
 * A title from the first message, shown until a generated one replaces it, and for
 * good if generating fails. Every untitled chat used to read the same, so the list
 * couldn't tell them apart. Skips the context line the console prepends.
 */
export function titleFromMessage(text: string): string | null {
  // Older chats have approval messages, and the "Run it" under one isn't a topic.
  if (text.startsWith("[approval]")) return null;
  const body = text
    .split("\n")
    .filter((line) => !line.startsWith("[context]"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return null;
  return body.length > TITLE_LENGTH ? `${body.slice(0, TITLE_LENGTH).trimEnd()}…` : body;
}
