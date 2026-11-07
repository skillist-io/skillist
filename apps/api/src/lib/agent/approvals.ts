import type { AgentApprovalStatus } from "@skillist/contracts";
import { agentApprovals } from "@skillist/db/schema";
import { and, desc, eq, gte, isNull, lt, or, type SQL } from "drizzle-orm";
import type { WorkerDb } from "../db";
import { requireOrgRole } from "../org-access";
import { sha256 } from "../r2";

/**
 * Human-in-the-loop approvals for the platform agent's write actions.
 *
 * Asking and running are separate on purpose. A tool can only ask (`requireApproval`):
 * it stages a row and returns `awaiting_approval`, and it can never run anything.
 * Running happens when a person approves, through `executeApproval`, from the stored
 * arguments. So a click means the action happened, not that a model was asked to
 * do it, and there's one place that can run an action.
 *
 *   - Someone below editor is refused with `needs_editor`. Approvals are per-user and
 *     deciding needs the editor role, so their request could never be decided.
 *   - A deterministic `callSignature` (sha-256 of the tool name + sorted args) finds
 *     the open row, so a model re-firing while it waits lands on the same one.
 *   - Anything finished (`executed`, `revoked`, `expired`, `refused`) stages a NEW row
 *     on a fresh identical call. An approval is only ever good for one run.
 *   - A refused action (`ok:false`) changed nothing, so it's marked `refused` with its
 *     reason rather than claiming it ran.
 *
 * Finished rows are the record of what a person allowed, and a card in an old
 * transcript is keyed to its row, so they are never reopened: doing that once made
 * "Approved and run." turn back into a live request.
 */

/** How long an approval stays good for. Consent given last month isn't consent now. */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The status to report for a row. An approval past its TTL reads as `expired` at
 * once, rather than waiting on a write: the queue is polled, and D1 has one writer.
 * `requireApproval` persists it the next time the same call comes through.
 */
export function effectiveStatus(row: {
  status: AgentApprovalStatus;
  decidedAt: Date | null;
}): AgentApprovalStatus {
  if (row.status !== "approved" || !row.decidedAt) return row.status;
  return Date.now() - row.decidedAt.getTime() > APPROVAL_TTL_MS ? "expired" : "approved";
}

export type AwaitingApproval = { ok: false; status: "awaiting_approval"; approvalId: string };
export type DeniedApproval = { ok: false; status: "denied" };
export type NeedsEditor = { ok: false; reason: "needs_editor" };

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

/** Ask for a decision on a gated call. Runs nothing, whatever state the row is in. */
export async function requireApproval(
  db: WorkerDb,
  input: {
    orgId: string;
    userId: string;
    chatId?: string | null;
    toolName: string;
    args: Record<string, unknown>;
  },
): Promise<AwaitingApproval | DeniedApproval | NeedsEditor> {
  const access = await requireOrgRole(db, input.orgId, input.userId, "editor");
  if (!access.ok) return { ok: false, reason: "needs_editor" };

  const signature = await callSignature(input.toolName, input.args);
  const match = and(
    eq(agentApprovals.orgId, input.orgId),
    eq(agentApprovals.userId, input.userId),
    eq(agentApprovals.toolName, input.toolName),
    eq(agentApprovals.callSignature, signature),
  );

  // Newest first. An open row blocks a new one, so if any exists this is it.
  const latest = async () =>
    (
      await db
        .select({
          id: agentApprovals.id,
          status: agentApprovals.status,
          decidedAt: agentApprovals.decidedAt,
        })
        .from(agentApprovals)
        .where(match)
        .orderBy(desc(agentApprovals.createdAt))
        .limit(1)
    )[0];

  let row = await latest();

  if (row && effectiveStatus(row) === "expired" && row.status === "approved") {
    await db
      .update(agentApprovals)
      .set({ status: "expired" })
      .where(and(eq(agentApprovals.id, row.id), eq(agentApprovals.status, "approved")));
    row = { ...row, status: "expired" };
  }

  if (!row || FINISHED.includes(row.status)) {
    // First time we've seen this call, or the last request for it is over. Either
    // way it needs a decision of its own. onConflictDoNothing covers a race where a
    // concurrent turn inserted the same open request.
    const [inserted] = await db
      .insert(agentApprovals)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        toolName: input.toolName,
        callSignature: signature,
        args: input.args,
        chatId: input.chatId ?? null,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning({
        id: agentApprovals.id,
        status: agentApprovals.status,
        decidedAt: agentApprovals.decidedAt,
      });
    row = inserted ?? (await latest());
  }

  if (row?.status === "denied") return { ok: false, status: "denied" };
  // Pending or approved: either way it's a person's move, not the model's.
  return { ok: false, status: "awaiting_approval", approvalId: row?.id ?? "" };
}

const FINISHED: AgentApprovalStatus[] = ["executed", "revoked", "expired", "refused"];

/** Tools report a refusal as `{ ok: false }` in a normal result, not by throwing. */
function refusalOf(result: unknown): string | null {
  if (typeof result !== "object" || result === null || !("ok" in result)) return null;
  if (result.ok !== false) return null;
  return "reason" in result && typeof result.reason === "string" ? result.reason : "refused";
}

/**
 * Run an approved action, once. `executed_at` is claimed in a single UPDATE before
 * anything happens, so a double click or a second tab loses the race instead of
 * running it twice. Null when there's nothing to run: not approved, out of date,
 * already claimed, or the person has lost the role.
 *
 * A throw releases the claim and leaves the row approved, because nothing is known to
 * have happened and the person can try again.
 */
export async function executeApproval<T>(
  db: WorkerDb,
  input: { orgId: string; userId: string; id: string },
  run: (row: typeof agentApprovals.$inferSelect) => Promise<T>,
) {
  const access = await requireOrgRole(db, input.orgId, input.userId, "editor");
  if (!access.ok) return null;

  const [row] = await db
    .update(agentApprovals)
    .set({ executedAt: new Date() })
    .where(
      and(
        eq(agentApprovals.id, input.id),
        eq(agentApprovals.orgId, input.orgId),
        eq(agentApprovals.userId, input.userId),
        statusIs("approved"),
        isNull(agentApprovals.executedAt),
      ),
    )
    .returning();
  if (!row) return null;

  const release = () =>
    db.update(agentApprovals).set({ executedAt: null }).where(eq(agentApprovals.id, row.id));

  let result: T;
  try {
    result = await run(row);
  } catch (err) {
    await release();
    throw err;
  }

  const refusal = refusalOf(result);
  const [finished] = await db
    .update(agentApprovals)
    .set(
      refusal
        ? { status: "refused", executedAt: null, outcomeReason: refusal }
        : { status: "executed" },
    )
    .where(eq(agentApprovals.id, row.id))
    .returning();
  return finished ?? null;
}

/** One of the caller's approvals. Scoped so an id can never reach another user's row. */
export async function getApproval(db: WorkerDb, orgId: string, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(agentApprovals)
    .where(
      and(
        eq(agentApprovals.id, id),
        eq(agentApprovals.orgId, orgId),
        eq(agentApprovals.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The caller's approval requests in this org, newest-first, optional status filter. */
export async function listApprovals(
  db: WorkerDb,
  orgId: string,
  userId: string,
  status?: AgentApprovalStatus,
) {
  const conditions = [eq(agentApprovals.orgId, orgId), eq(agentApprovals.userId, userId)];
  if (status) conditions.push(statusIs(status));
  return db
    .select()
    .from(agentApprovals)
    .where(and(...conditions))
    .orderBy(desc(agentApprovals.createdAt))
    .limit(100);
}

/** Expiry is derived, so a stored `approved` can be reported as either of two statuses. */
function statusIs(status: AgentApprovalStatus): SQL {
  const cutoff = new Date(Date.now() - APPROVAL_TTL_MS);
  const approved = eq(agentApprovals.status, "approved");
  if (status === "approved") {
    return and(approved, gte(agentApprovals.decidedAt, cutoff)) as SQL;
  }
  if (status === "expired") {
    return or(
      eq(agentApprovals.status, "expired"),
      and(approved, lt(agentApprovals.decidedAt, cutoff)),
    ) as SQL;
  }
  return eq(agentApprovals.status, status);
}

/** A position in the record. Two rows can share a millisecond, so the id breaks ties. */
export type RecordCursor = { createdAt: Date; id: string };

/**
 * Every member's requests in an org, newest first, for the owner's record in
 * Governance. Read-only: deciding stays with the person who asked, because the
 * action runs in their conversation under their identity.
 */
export async function listOrgApprovals(
  db: WorkerDb,
  orgId: string,
  options: {
    limit: number;
    status?: AgentApprovalStatus;
    userId?: string;
    before?: RecordCursor;
  },
) {
  const { limit, status, userId, before } = options;
  const conditions: (SQL | undefined)[] = [eq(agentApprovals.orgId, orgId)];
  if (status) conditions.push(statusIs(status));
  if (userId) conditions.push(eq(agentApprovals.userId, userId));
  if (before) {
    conditions.push(
      or(
        lt(agentApprovals.createdAt, before.createdAt),
        and(eq(agentApprovals.createdAt, before.createdAt), lt(agentApprovals.id, before.id)),
      ),
    );
  }
  // One extra row says whether there's a next page without a count query.
  const rows = await db
    .select()
    .from(agentApprovals)
    .where(and(...conditions))
    .orderBy(desc(agentApprovals.createdAt), desc(agentApprovals.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page,
    next: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
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
    .set({ status: input.status, decidedAt: new Date(), decidedBy: input.userId })
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

/**
 * Take back an approval that hasn't run. Scoped like `decideApproval`. Null when
 * there's nothing to revoke, which includes an action that has already run.
 */
export async function revokeApproval(
  db: WorkerDb,
  input: { orgId: string; userId: string; id: string },
) {
  const [row] = await db
    .update(agentApprovals)
    .set({ status: "revoked", revokedAt: new Date(), revokedBy: input.userId })
    .where(
      and(
        eq(agentApprovals.id, input.id),
        eq(agentApprovals.orgId, input.orgId),
        eq(agentApprovals.userId, input.userId),
        eq(agentApprovals.status, "approved"),
        // Claimed means it's running now, which is too late to take back.
        isNull(agentApprovals.executedAt),
      ),
    )
    .returning();
  return row ?? null;
}
