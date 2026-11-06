import { ApiError } from "@skillist/ui";

export type ApprovalCopy = {
  /** The action, as a question-free statement of what would happen. */
  title: string;
  /** What approving causes, stated before the person decides. */
  effect: string;
  /** The exact text being approved. Never truncated. */
  detail?: string;
  /** Set when the action targets a skill, so the card can link to it. */
  skillRepo?: string;
};

function text(args: Record<string, unknown> | null | undefined, key: string): string {
  const v = args?.[key];
  return typeof v === "string" ? v : "";
}

/** Plain-language description of a gated action, shared by the card and the queue. */
export function describeApproval(
  toolName: string,
  args: Record<string, unknown> | null | undefined,
): ApprovalCopy {
  switch (toolName) {
    case "draft_improvement":
      return {
        title: `Draft an improvement for ${text(args, "skillRepo")}`,
        effect:
          "Opens pending feedback in the review inbox. The skill itself doesn't change until a reviewer approves it.",
        detail: text(args, "note"),
        skillRepo: text(args, "skillRepo"),
      };
    case "remember":
      return {
        title: `Save org fact ${text(args, "key")}`,
        effect: "Every member's agent will read this fact, from their next message onward.",
        detail: text(args, "value"),
      };
    case "forget":
      return {
        title: `Forget org fact ${text(args, "key")}`,
        effect: "Removes this fact from every member's agent.",
      };
    default:
      return {
        title: toolName.replace(/_/g, " "),
        effect: "Runs this action once, with the arguments below.",
        detail: args ? JSON.stringify(args, null, 2) : undefined,
      };
  }
}

/** Deciding needs the editor role, which a chat participant may not have. */
export function decisionError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "Your role can't decide this. Approving agent actions needs editor access.";
  }
  if (error instanceof ApiError && error.status === 404) {
    return "This request has already been decided.";
  }
  return "Couldn't record your decision. Try again.";
}
