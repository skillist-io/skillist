import { feedback, skills } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import type { WorkerDb } from "../db";
import { forgetFact, rememberFact } from "./memory";

type Row = { orgId: string; userId: string; toolName: string; args: unknown };

const REFUSALS: Record<string, string> = {
  skill_not_found: "that skill doesn't exist",
  no_published_version: "that skill has no published version",
  insert_failed: "the write didn't complete",
  unknown_action: "this action can no longer be run",
};

/** A refusal's reason in words, for the transcript and the record. */
export function refusalWords(reason: string | null | undefined): string {
  if (!reason) return "the action was refused";
  return REFUSALS[reason] ?? reason.replace(/_/g, " ");
}

/**
 * Run a gated action from its stored arguments. A person approved exactly these, so
 * nothing here is restated by a model. Called only through `executeApproval`, which
 * is what guarantees one run.
 */
export async function runApprovedAction(db: WorkerDb, row: Row) {
  const args = (row.args ?? {}) as Record<string, unknown>;
  const text = (name: string) => String(args[name] ?? "");

  switch (row.toolName) {
    case "draft_improvement": {
      const [skill] = await db
        .select()
        .from(skills)
        .where(and(eq(skills.orgId, row.orgId), eq(skills.repo, text("skillRepo"))))
        .limit(1);
      if (!skill) return { ok: false as const, reason: "skill_not_found" };
      if (!skill.latestPublishedVersionId) {
        return { ok: false as const, reason: "no_published_version" };
      }
      const [inserted] = await db
        .insert(feedback)
        .values({
          skillId: skill.id,
          targetVersionId: skill.latestPublishedVersionId,
          source: "agent",
          status: "pending",
          body: text("note"),
          submittedBy: null,
        })
        .returning({ id: feedback.id });
      if (!inserted) return { ok: false as const, reason: "insert_failed" };
      return { ok: true as const };
    }
    case "remember":
      await rememberFact(db, {
        orgId: row.orgId,
        userId: null,
        key: text("key"),
        value: text("value"),
        source: "agent",
        updatedBy: row.userId,
      });
      return { ok: true as const };
    case "forget":
      await forgetFact(db, row.orgId, row.userId, text("key"));
      return { ok: true as const };
    default:
      return { ok: false as const, reason: "unknown_action" };
  }
}

/** The action in past tense, for a line that says what really happened. */
function didWhat(row: Row): string {
  const args = (row.args ?? {}) as Record<string, unknown>;
  const text = (name: string) => String(args[name] ?? "");
  switch (row.toolName) {
    case "draft_improvement":
      return `Drafted an improvement for ${text("skillRepo")}.`;
    case "remember":
      return `Saved org fact ${text("key")}.`;
    case "forget":
      return `Forgot org fact ${text("key")}.`;
    default:
      return "The action ran.";
  }
}

/**
 * The line added to the conversation after a decision. Written by the server rather
 * than the model, so it can't disagree with the record.
 */
export function decisionLine(
  row: Row,
  outcome: { status: string; reason?: string | null },
): string {
  switch (outcome.status) {
    case "executed":
      return `Approved by you. ${didWhat(row)}`;
    case "refused":
      return `Approved by you, but it couldn't run: ${refusalWords(outcome.reason)}. Nothing changed.`;
    case "revoked":
      return "Approval revoked by you. Nothing ran.";
    default:
      return "Denied by you. Nothing ran.";
  }
}
