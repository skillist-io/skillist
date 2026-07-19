import type { AgentApprovalStatus } from "@skillist/contracts";
import { agentApprovals } from "@skillist/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { WorkerDb } from "../db";
import { sha256 } from "../r2";

/**
 * Human-in-the-loop approvals for the platform agent's write actions.
 *
 * Flow (see `requireApproval`):
 *   1. The model calls a wrapped tool with some args.
 *   2. We compute a deterministic `callSignature` (sha-256 of the tool name +
 *      sorted args) and SELECT-or-INSERT an `agent_approvals` row.
 *   3. status = "pending"  → return `{ ok:false, status:"awaiting_approval" }`
 *      WITHOUT running — the agent tells the user to approve in the console.
 *   4. status = "denied"   → return `{ ok:false, status:"denied" }`.
 *   5. status = "approved" → run the wrapped action, then DELETE the row so a
 *      fresh identical call needs a new approval (approval is consumed).
 *
 * The UNIQUE (org_id, user_id, tool_name, call_signature) constraint makes a
 * retry of the same logical call idempotent — the model can re-fire while
 * waiting and always lands on the same row.
 */

export type AwaitingApproval = { ok: false; status: "awaiting_approval"; approvalId: string };
export type DeniedApproval = { ok: false; status: "denied" };

/** Recursively sort object keys so the JSON encoding is order-independent. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}

/**
 * Deterministic signature of a tool call. The tool name plus canonically-sorted
 * args are hashed, so the same logical call always yields the same signature
 * regardless of argument property order.
 */
export async function callSignature(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  return sha256(`${toolName}:${JSON.stringify(sortKeys(args))}`);
}

/**
 * Gate `run()` behind a human decision. Returns the wrapped action's result
 * once approved (and consumes the approval), or an awaiting/denied sentinel.
 */
export async function requireApproval<T>(
  db: WorkerDb,
  input: { orgId: string; userId: string; toolName: string; args: Record<string, unknown> },
  run: () => Promise<T>,
): Promise<T | AwaitingApproval | DeniedApproval> {
  const signature = await callSignature(input.toolName, input.args);
  const match = and(
    eq(agentApprovals.orgId, input.orgId),
    eq(agentApprovals.userId, input.userId),
    eq(agentApprovals.toolName, input.toolName),
    eq(agentApprovals.callSignature, signature),
  );

  let [row] = await db
    .select({ id: agentApprovals.id, status: agentApprovals.status })
    .from(agentApprovals)
    .where(match)
    .limit(1);

  if (!row) {
    // First time we've seen this call — request approval. onConflictDoNothing
    // covers a race where a concurrent turn inserted the same signature.
    const [inserted] = await db
      .insert(agentApprovals)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        toolName: input.toolName,
        callSignature: signature,
        args: input.args,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning({ id: agentApprovals.id, status: agentApprovals.status });
    row =
      inserted ??
      (
        await db
          .select({ id: agentApprovals.id, status: agentApprovals.status })
          .from(agentApprovals)
          .where(match)
          .limit(1)
      )[0];
  }

  if (!row || row.status === "pending") {
    return { ok: false, status: "awaiting_approval", approvalId: row?.id ?? "" };
  }
  if (row.status === "denied") {
    return { ok: false, status: "denied" };
  }

  // Approved — run the action, then consume the approval so a re-run needs a
  // fresh decision. The delete is best-effort; the action already succeeded.
  const result = await run();
  await db.delete(agentApprovals).where(eq(agentApprovals.id, row.id));
  return result;
}

/** The caller's approval requests in this org, newest-first, optional status filter. */
export async function listApprovals(
  db: WorkerDb,
  orgId: string,
  userId: string,
  status?: AgentApprovalStatus,
) {
  const conditions = [eq(agentApprovals.orgId, orgId), eq(agentApprovals.userId, userId)];
  if (status) conditions.push(eq(agentApprovals.status, status));
  return db
    .select()
    .from(agentApprovals)
    .where(and(...conditions))
    .orderBy(desc(agentApprovals.createdAt))
    .limit(100);
}

/**
 * Decide a pending approval. Scoped to the caller so one user can never decide
 * another's request. Returns the updated row, or null when there was no
 * matching pending row (already decided / not found / not the caller's).
 */
export async function decideApproval(
  db: WorkerDb,
  input: { orgId: string; userId: string; id: string; status: "approved" | "denied" },
) {
  const [row] = await db
    .update(agentApprovals)
    .set({ status: input.status, decidedAt: new Date() })
    .where(
      and(
        eq(agentApprovals.id, input.id),
        eq(agentApprovals.orgId, input.orgId),
        eq(agentApprovals.userId, input.userId),
        eq(agentApprovals.status, "pending"),
      ),
    )
    .returning();
  return row ?? null;
}
