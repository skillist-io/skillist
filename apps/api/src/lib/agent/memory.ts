import { agentMemory } from "@skillist/db/schema";
import { and, desc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import type { WorkerDb } from "../db";
import { type RedactionResult, redactPII } from "../pii";

/**
 * Durable governance memory for the platform agent.
 *
 * Rows live in `agent_memory`, keyed by (orgId, userId, key) with a
 * unique index on the generated `user_scope`. A NULL `userId` is an ORG-WIDE fact
 * (governance policy, a skill's known quirk, a naming convention); a set
 * `userId` is a fact scoped to one user. The agent reads the org's visible
 * memories into its system prompt each turn and writes new ones via the
 * `remember` tool. Every value is PII-redacted before it is persisted so a
 * user can't accidentally park an email/phone/SSN/card in long-term store.
 */

/** How many memories to inject into the system prompt per turn. */
const MEMORY_BLOCK_LIMIT = 30;

/** How many memories a search/list returns at most. */
const MEMORY_LIST_LIMIT = 50;

export type MemoryRow = {
  id: string;
  orgId: string;
  userId: string | null;
  key: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The visibility predicate: org-wide rows (userId IS NULL) plus, when a caller
 * user id is known, that user's own rows. A caller with no user id sees only
 * org-wide facts.
 */
function visibleTo(userId: string | null): SQL | undefined {
  return userId
    ? or(isNull(agentMemory.userId), eq(agentMemory.userId, userId))
    : isNull(agentMemory.userId);
}

/**
 * Upsert a memory. `value` is PII-redacted BEFORE persist; the redaction tally
 * is returned so the caller can note if anything was stripped. Org-scoped when
 * `userId` is null, otherwise scoped to that user. Re-writing the same
 * (org, user, key) UPDATEs in place rather than duplicating.
 */
export async function rememberFact(
  db: WorkerDb,
  input: { orgId: string; userId: string | null; key: string; value: string },
): Promise<{ redaction: RedactionResult }> {
  const redaction = redactPII(input.value);
  await db
    .insert(agentMemory)
    .values({
      orgId: input.orgId,
      userId: input.userId ?? null,
      key: input.key,
      value: redaction.text,
    })
    .onConflictDoUpdate({
      // user_scope, not user_id: SQLite treats NULLs as distinct, so this generated
      // column is what makes a null userId dedupe org-wide facts.
      target: [agentMemory.orgId, agentMemory.userScope, agentMemory.key],
      set: { value: redaction.text, updatedAt: new Date() },
    });
  return { redaction };
}

/**
 * The org's memories the caller can see (org-wide + their own), newest-first,
 * capped. A non-empty `query` filters by case-insensitive substring over key or
 * value.
 */
export async function searchMemory(
  db: WorkerDb,
  orgId: string,
  userId: string | null,
  query?: string,
): Promise<MemoryRow[]> {
  const conditions: Array<SQL | undefined> = [eq(agentMemory.orgId, orgId), visibleTo(userId)];
  const q = query?.trim();
  if (q) {
    // instr, not LIKE: D1 caps a LIKE pattern at 50 bytes.
    conditions.push(
      or(
        sql`instr(lower(${agentMemory.key}), lower(${q})) > 0`,
        sql`instr(lower(${agentMemory.value}), lower(${q})) > 0`,
      ),
    );
  }
  return db
    .select()
    .from(agentMemory)
    .where(and(...conditions))
    .orderBy(desc(agentMemory.updatedAt))
    .limit(MEMORY_LIST_LIMIT);
}

/**
 * Delete a memory by key within the caller's scope — an org-wide fact or the
 * caller's own fact with that key.
 */
export async function forgetFact(
  db: WorkerDb,
  orgId: string,
  userId: string | null,
  key: string,
): Promise<void> {
  await db
    .delete(agentMemory)
    .where(and(eq(agentMemory.orgId, orgId), eq(agentMemory.key, key), visibleTo(userId)));
}

/**
 * Render up to N visible memories as a compact block for the system prompt.
 * Pure — split out so the formatting is unit-testable without a database.
 * Returns "" for an empty list.
 */
export function formatMemoryBlock(rows: Array<{ key: string; value: string }>): string {
  if (rows.length === 0) return "";
  const lines = rows.map((r) => `- ${r.key}: ${r.value}`);
  return ["Known facts about this org:", ...lines].join("\n");
}

/**
 * Fetch the top-N visible memories and format them for the system prompt.
 * Returns "" when there is no org scope or no memories.
 */
export async function buildMemoryBlock(
  db: WorkerDb,
  orgId: string | null,
  userId: string | null,
): Promise<string> {
  if (!orgId) return "";
  const rows = await db
    .select({ key: agentMemory.key, value: agentMemory.value })
    .from(agentMemory)
    .where(and(eq(agentMemory.orgId, orgId), visibleTo(userId)))
    .orderBy(desc(agentMemory.updatedAt))
    .limit(MEMORY_BLOCK_LIMIT);
  return formatMemoryBlock(rows);
}
