import type { AgentApprovalStatus } from "@skillist/contracts";
import { ApiError } from "@skillist/ui";

export type ApprovalCopy = {
  /** The action, as a question-free statement of what would happen. */
  title: string;
  /** `title` in two parts, so the machine name can be set as data. */
  action: string;
  subject?: string;
  /** The approve button. Names what will happen, and that it happens now. */
  approveLabel: string;
  /** What approving causes, stated before the person decides. */
  effect: string;
  /** The exact text being approved. Never truncated. */
  detail?: string;
  /** The detail is data rather than prose. */
  detailIsData?: boolean;
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
        action: "Draft an improvement for",
        subject: text(args, "skillRepo"),
        approveLabel: "Approve and draft",
        effect:
          "Opens pending feedback in the review inbox. The skill itself doesn't change until a reviewer approves it.",
        detail: text(args, "note"),
        skillRepo: text(args, "skillRepo"),
      };
    case "remember":
      return {
        title: `Save org fact ${text(args, "key")}`,
        action: "Save org fact",
        subject: text(args, "key"),
        approveLabel: "Approve and save",
        effect: "Every member's agent will read this fact, from their next message onward.",
        detail: text(args, "value"),
      };
    case "forget":
      return {
        title: `Forget org fact ${text(args, "key")}`,
        action: "Forget org fact",
        subject: text(args, "key"),
        approveLabel: "Approve and forget",
        effect: "Removes this fact from every member's agent.",
      };
    default:
      return {
        title: toolName.replace(/_/g, " "),
        action: toolName.replace(/_/g, " "),
        approveLabel: "Approve and run",
        effect: "Runs this action once, with the arguments below.",
        detail: args ? JSON.stringify(args, null, 2) : undefined,
        detailIsData: true,
      };
  }
}

/**
 * Whether a role can decide, mirroring the REST route's editor minimum (owner and
 * editor rank at or above it; publisher and viewer don't). This only decides what
 * to show: the route is what enforces it. An unknown role keeps the buttons, so
 * the org list loading never hides a decision from someone who can make it.
 */
export function canDecideApprovals(role: string | undefined): boolean {
  return role === undefined || role === "owner" || role === "editor";
}

/** What became of a request that is no longer waiting on anyone. */
export const OUTCOME: Partial<Record<AgentApprovalStatus, string>> = {
  executed: "Approved and run.",
  denied: "Denied. Nothing ran.",
  revoked: "Approval revoked. Nothing ran.",
  expired: "Approval expired before it ran. Nothing ran.",
  refused: "Approved, but the action was refused. Nothing changed.",
};

/** Short status words, shared by the panel and the org record. Never colour alone. */
export const STATUS_LABEL: Record<AgentApprovalStatus, string> = {
  pending: "Awaiting review",
  approved: "Approved, not run",
  executed: "Ran",
  denied: "Denied",
  revoked: "Revoked",
  expired: "Expired",
  refused: "Refused",
};

export const NEEDS_EDITOR = "Nothing has run. Approving this needs editor access.";

/** Deciding needs the editor role, which a chat participant may not have. */
export function decisionError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "Your role can't decide this. Approving agent actions needs editor access.";
  }
  if (error instanceof ApiError && error.status === 404) {
    return "This request has already been decided, or has already run.";
  }
  return "Couldn't record your decision. Try again.";
}
