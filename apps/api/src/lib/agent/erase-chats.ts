import { agentChats } from "@skillist/db/schema";
import { eq, or } from "drizzle-orm";
import { composeAgentName } from "../../agent/agent-name";
import { wipeChat } from "../../agent/chat-delete";
import type { SkillistAgent } from "../../agent/skillist-agent";
import { inList, type WorkerDb } from "../db";

/** Enough to keep an account with many chats quick, without a burst of subrequests. */
const CONCURRENCY = 8;

/**
 * Wipe the transcripts that are about to lose their `agent_chats` rows: everything the
 * user wrote, in any org, and every chat in the orgs being deleted with them, including
 * former members'. Those rows cascade away with the user or the org, and a row is the
 * only way to a transcript's name, so a transcript left now can never be found again
 * except by `pnpm purge:orphan-chats`.
 *
 * Wipes go by name, never raw id (see lib/agent/orphan-chats.ts). This runs before
 * anything is deleted, and the caller stops if anything failed, so the rows survive and
 * a retry can finish the job.
 */
export async function eraseAgentChats(
  db: WorkerDb,
  ns: DurableObjectNamespace,
  { userId, orgIds }: { userId: string; orgIds: string[] },
): Promise<{ wiped: number; failed: number }> {
  const where = orgIds.length
    ? or(eq(agentChats.userId, userId), inList(agentChats.orgId, orgIds))
    : eq(agentChats.userId, userId);
  const rows = await db
    .select({ id: agentChats.id, orgId: agentChats.orgId, userId: agentChats.userId })
    .from(agentChats)
    .where(where);

  let wiped = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const results = await Promise.allSettled(
      rows.slice(i, i + CONCURRENCY).map((row) => {
        const id = ns.idFromName(composeAgentName(row.orgId, row.userId, row.id));
        return wipeChat(ns.get(id) as unknown as SkillistAgent);
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled") wiped += 1;
      else {
        failed += 1;
        console.error("Agent chat wipe failed during account deletion", result.reason);
      }
    }
  }
  return { wiped, failed };
}
