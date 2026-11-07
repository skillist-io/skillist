import { composeAgentName } from "../../agent/agent-name";
import { wipeChat } from "../../agent/chat-delete";
import type { SkillistAgent } from "../../agent/skillist-agent";

/**
 * Finding and wiping chat objects nothing points at any more: chats deleted before
 * #187, when delete removed the `agent_chats` row and left the transcript behind.
 *
 * The rule everything here follows: never address a chat object by raw id. An object
 * started from `idFromString()` has no `ctx.id.name`, so the Agents SDK throws on every
 * call, and a later call BY NAME lands on that same nameless instance and throws too,
 * until it's evicted. Done to a live chat, that takes the chat down. So only the Cloudflare
 * query API reads objects by id, only for ids no row claims, and wiping goes by name.
 */

/** Run through the query API, which reads an object's SQLite without the class. */
export const CHAT_STATE_SQL = "SELECT state FROM cf_agents_state WHERE id = 'cf_state_row_id'";
/** A chat with no messages may not have this table yet. Querying it would be an error. */
export const MESSAGE_TABLE_SQL =
  "SELECT count(*) FROM sqlite_master WHERE name = 'cf_agents_session_messages'";
export const CHAT_MESSAGES_SQL =
  "SELECT count(*), max(created_at) FROM cf_agents_session_messages WHERE type = 'message'";

export type ChatIdentity = { orgId: string; userId: string; chatId: string };

export type StoredChat = {
  identity: ChatIdentity | null;
  messages: number;
  lastMessageAt: number | null;
};

export type ChatVerdict =
  /** No row, has a transcript, and has been quiet for the whole window. */
  | "orphan"
  /** Nothing to purge: a chat opened and never used has no row and no messages. */
  | "empty"
  /** Could be a first turn whose row hasn't landed yet. */
  | "recent"
  /** We can't name it, so we can't wipe it safely. Reported, never touched. */
  | "unidentified";

/** Parse the JSON in `cf_agents_state`. Anything short of all three ids is no identity. */
export function parseChatState(raw: unknown): ChatIdentity | null {
  if (typeof raw !== "string") return null;
  try {
    const { orgId, userId, chatId } = JSON.parse(raw) as Record<string, unknown>;
    if (typeof orgId !== "string" || !orgId) return null;
    if (typeof userId !== "string" || !userId) return null;
    if (typeof chatId !== "string" || !chatId) return null;
    return { orgId, userId, chatId };
  } catch {
    return null;
  }
}

export function classifyChat(chat: StoredChat, now: number, minIdleMs: number): ChatVerdict {
  if (!chat.identity) return "unidentified";
  if (chat.messages === 0) return "empty";
  // A transcript we can't date could be from a moment ago, so it counts as recent.
  if (chat.lastMessageAt === null || now - chat.lastMessageAt < minIdleMs) return "recent";
  return "orphan";
}

/**
 * Which of these object ids no `agent_chats` row accounts for. `idFromName` only works
 * inside a Worker, which is why this can't be done from the script. It computes ids from
 * the rows and never opens an object, so it's safe to run against live chats.
 */
export function unclaimedObjectIds(
  ns: Pick<DurableObjectNamespace, "idFromName">,
  rows: ChatIdentityRow[],
  objectIds: string[],
): string[] {
  const claimed = new Set(
    rows.map((row) => ns.idFromName(composeAgentName(row.orgId, row.userId, row.id)).toString()),
  );
  return objectIds.filter((id) => !claimed.has(id.toLowerCase()));
}

export type ChatIdentityRow = { id: string; orgId: string; userId: string };

export type PurgeOutcome =
  /** Gone. */
  | "wiped"
  /** A row claims this chat, so someone can still open it. */
  | "has_row"
  /** The ids given don't name this object, so wiping them would hit a different one. */
  | "id_mismatch"
  /** The wipe itself failed, and the transcript may still be there. */
  | "failed";

/**
 * Wipe one orphan through the same `destroy()` a normal delete uses. Both checks are here
 * rather than in the script because this is the line that can't be undone: the script's
 * view may be stale, and the row check has to be the last thing before the wipe.
 */
export async function purgeChat(
  ns: DurableObjectNamespace,
  chat: ChatIdentity & { objectId: string },
  hasRow: (chatId: string) => Promise<boolean>,
): Promise<PurgeOutcome> {
  const id = ns.idFromName(composeAgentName(chat.orgId, chat.userId, chat.chatId));
  if (id.toString() !== chat.objectId.toLowerCase()) return "id_mismatch";
  if (await hasRow(chat.chatId)) return "has_row";
  try {
    await wipeChat(ns.get(id) as unknown as SkillistAgent);
    return "wiped";
  } catch (err) {
    console.error("Orphan chat purge failed", chat.objectId, err);
    return "failed";
  }
}
