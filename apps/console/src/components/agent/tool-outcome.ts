import type { getToolPartState } from "@cloudflare/ai-chat/react";

/** The SDK's lifecycle state. It describes the call, not whether the call worked. */
export type ToolPartState = ReturnType<typeof getToolPartState>;

export type ToolOutcome =
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "awaiting"; approvalId?: string }
  | { kind: "denied" }
  | { kind: "refused"; reason: string }
  | { kind: "failed"; reason?: string };

const REASONS: Record<string, string> = {
  skill_not_found: "skill not found",
  no_published_version: "the skill has no published version",
  no_user_scope: "no signed-in user on this conversation",
  no_org_scope: "no organization on this conversation",
  insert_failed: "the write did not complete",
  needs_editor: "this needs an editor or owner",
  approval_not_found: "that approval no longer exists",
  already_ran: "that approval has already run",
  approval_revoked: "that approval was revoked",
  approval_expired: "that approval expired",
  approval_refused: "that action was already refused",
  unknown_action: "this action can no longer be run",
};

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * What actually happened on a tool call.
 *
 * `getToolPartState` reports `complete` for any call that returned, and our tools
 * return refusals as ordinary results: `{ ok:false, status:"awaiting_approval" }`
 * comes back as `complete`. Reading only that state is how a gated action that
 * never ran rendered as "Drafted improvement" with a check. The output decides.
 */
export function toolOutcome(
  state: ToolPartState,
  output: unknown,
  errorText?: string,
): ToolOutcome {
  if (state === "error") return { kind: "failed", reason: errorText };
  if (state === "denied") return { kind: "denied" };
  if (state === "waiting-approval") return { kind: "awaiting" };
  if (state === "loading" || state === "streaming") return { kind: "running" };

  if (field(output, "ok") !== false) return { kind: "done" };

  const status = field(output, "status");
  if (status === "awaiting_approval") {
    const approvalId = field(output, "approvalId");
    return {
      kind: "awaiting",
      approvalId: typeof approvalId === "string" && approvalId ? approvalId : undefined,
    };
  }
  if (status === "denied") return { kind: "denied" };

  const reason = field(output, "reason");
  if (typeof reason !== "string") return { kind: "refused", reason: "the tool declined" };
  return { kind: "refused", reason: REASONS[reason] ?? reason.replace(/_/g, " ") };
}
