/**
 * Finds chat transcripts nothing points at any more, and wipes them if you ask.
 *
 * Before #187, deleting a conversation removed its `agent_chats` row and left the
 * transcript in its Durable Object. See apps/api/src/lib/agent/orphan-chats.ts for how
 * these are found, and why objects are only ever read through the query API.
 *
 *   pnpm purge:orphan-chats                        # production, dry run (reads only)
 *   pnpm purge:orphan-chats --min-idle-hours=48    # widen the quiet window (default 24)
 *   pnpm purge:orphan-chats --apply                # production, wipes what the dry run lists
 *
 * Wiping can't be undone. Run the dry run first and read it. It prints ids and dates,
 * never transcript text.
 *
 * Requires:
 *   CLOUDFLARE_API_TOKEN   with Workers Scripts Write, which the query API needs
 *   CLOUDFLARE_ACCOUNT_ID
 *   SKILLIST_ADMIN_KEY     an `sk_` key with the admin:agent-chats scope, created by a
 *                          user in SKILLIST_ADMIN_USER_IDS
 */
import {
  CHAT_MESSAGES_SQL,
  CHAT_STATE_SQL,
  type ChatIdentity,
  type ChatVerdict,
  classifyChat,
  MESSAGE_TABLE_SQL,
  type PurgeOutcome,
  parseChatState,
  type StoredChat,
} from "../apps/api/src/lib/agent/orphan-chats";

const HOUR_MS = 3_600_000;
const AGENT_CLASS = "SkillistAgent";
const AGENT_SCRIPT = "skillist-api-production";
const UNCLAIMED_BATCH = 1000;
const PURGE_BATCH = 25;

const apply = process.argv.includes("--apply");
const idleArg = process.argv.find((arg) => arg.startsWith("--min-idle-hours="));
const minIdleHours = idleArg ? Number(idleArg.split("=")[1]) : 24;

const cfBase = process.env.CLOUDFLARE_API_URL ?? "https://api.cloudflare.com/client/v4";
const apiBase = process.env.SKILLIST_API_URL ?? "https://api.skillist.dev";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See the top of this script.`);
  return value;
}

type CfEnvelope<T> = {
  success: boolean;
  errors?: { message: string }[];
  result: T;
  result_info?: { cursor?: string };
};

async function cf<T>(path: string, init?: RequestInit): Promise<CfEnvelope<T>> {
  const res = await fetch(`${cfBase}/accounts/${required("CLOUDFLARE_ACCOUNT_ID")}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${required("CLOUDFLARE_API_TOKEN")}`,
      "content-type": "application/json",
    },
  });
  const body = (await res.json()) as CfEnvelope<T>;
  if (!res.ok || !body.success) {
    throw new Error(`Cloudflare ${path}: ${res.status} ${JSON.stringify(body.errors ?? [])}`);
  }
  return body;
}

async function skillist<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase}/v1${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${required("SKILLIST_ADMIN_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Skillist ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function findNamespace(): Promise<string> {
  const { result } = await cf<{ id: string; class: string; script: string }[]>(
    "/workers/durable_objects/namespaces?per_page=1000",
  );
  const match = result.filter((ns) => ns.class === AGENT_CLASS && ns.script === AGENT_SCRIPT);
  if (match.length !== 1 || !match[0]) {
    throw new Error(
      `Expected one ${AGENT_CLASS} namespace on ${AGENT_SCRIPT}, ${match.length} found`,
    );
  }
  return match[0].id;
}

async function listObjectIds(namespace: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const query = `limit=10000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = await cf<{ id: string; hasStoredData?: boolean }[]>(
      `/workers/durable_objects/namespaces/${namespace}/objects?${query}`,
    );
    ids.push(...page.result.filter((o) => o.hasStoredData !== false).map((o) => o.id));
    cursor = page.result_info?.cursor || undefined;
  } while (cursor);
  return ids;
}

type QueryResult = { error?: string; results: { rows: unknown[][] }[] };

async function query(namespace: string, objectId: string, sql: string[]): Promise<unknown[][][]> {
  const { result } = await cf<QueryResult>(
    `/workers/durable_objects/namespaces/${namespace}/query/v2`,
    {
      method: "POST",
      body: JSON.stringify({
        durable_object_id: objectId,
        queries: sql.map((statement) => ({ sql: statement })),
      }),
    },
  );
  if (result.error) throw new Error(`Query on ${objectId}: ${result.error}`);
  return result.results.map((r) => r.rows);
}

async function readChat(namespace: string, objectId: string): Promise<StoredChat> {
  const [stateRows, tableRows] = await query(namespace, objectId, [
    CHAT_STATE_SQL,
    MESSAGE_TABLE_SQL,
  ]);
  const identity = parseChatState(stateRows?.[0]?.[0]);
  if (tableRows?.[0]?.[0] !== 1) return { identity, messages: 0, lastMessageAt: null };
  const [messageRows] = await query(namespace, objectId, [CHAT_MESSAGES_SQL]);
  const [count, lastAt] = messageRows?.[0] ?? [];
  return {
    identity,
    messages: Number(count ?? 0),
    lastMessageAt: typeof lastAt === "number" ? lastAt : null,
  };
}

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  if (!Number.isFinite(minIdleHours) || minIdleHours < 1) {
    throw new Error("--min-idle-hours must be at least 1");
  }
  // Printed first so a wrong target is visible before anything is read or written.
  console.log(`Target: ${apiBase}`);
  console.log(`Mode:   ${apply ? "APPLY (permanently wipes transcripts)" : "dry run (no writes)"}`);
  console.log(`Quiet:  at least ${minIdleHours}h since the last message\n`);

  const namespace = await findNamespace();
  const objectIds = await listObjectIds(namespace);

  // Rows first, and nothing with a row is opened: the query API's effect on a live
  // chat isn't documented, so it only goes near objects nobody can reach.
  const unclaimed: string[] = [];
  for (const batch of batches(objectIds, UNCLAIMED_BATCH)) {
    const found = await skillist<{ unclaimed: string[] }>("/admin/agent-chats/unclaimed", {
      objectIds: batch,
    });
    unclaimed.push(...found.unclaimed);
  }

  const counts: Record<ChatVerdict | "unreadable", number> = {
    orphan: 0,
    empty: 0,
    recent: 0,
    unidentified: 0,
    unreadable: 0,
  };
  const orphans: (ChatIdentity & { objectId: string })[] = [];
  const now = Date.now();
  for (const objectId of unclaimed) {
    let chat: StoredChat;
    try {
      chat = await readChat(namespace, objectId);
    } catch (err) {
      counts.unreadable += 1;
      console.log(`  UNREADABLE ${objectId}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const verdict = classifyChat(chat, now, minIdleHours * HOUR_MS);
    counts[verdict] += 1;
    const last = chat.lastMessageAt ? new Date(chat.lastMessageAt).toISOString() : "no date";
    const who = chat.identity
      ? `org ${chat.identity.orgId} user ${chat.identity.userId} chat ${chat.identity.chatId}`
      : "no identity";
    console.log(`  ${verdict.toUpperCase()} ${objectId} ${who}, ${chat.messages} msgs, ${last}`);
    if (verdict === "orphan" && chat.identity) orphans.push({ ...chat.identity, objectId });
  }

  console.log(`\nObjects:   ${objectIds.length}`);
  console.log(`With a row: ${objectIds.length - unclaimed.length} (not opened)`);
  console.log(`Orphans:   ${counts.orphan}`);
  console.log(
    `Left alone: ${counts.empty} empty, ${counts.recent} recent, ${counts.unidentified} unidentified, ${counts.unreadable} unreadable`,
  );

  if (!apply) {
    if (orphans.length > 0) console.log("\nNothing was wiped. Re-run with --apply to wipe these.");
    return;
  }

  const outcomes: Record<PurgeOutcome, number> = {
    wiped: 0,
    has_row: 0,
    id_mismatch: 0,
    failed: 0,
  };
  for (const chats of batches(orphans, PURGE_BATCH)) {
    const { results } = await skillist<{ results: { objectId: string; outcome: PurgeOutcome }[] }>(
      "/admin/agent-chats/purge",
      { chats },
    );
    for (const { objectId, outcome } of results) {
      outcomes[outcome] += 1;
      if (outcome !== "wiped") console.log(`  ${outcome.toUpperCase()} ${objectId}`);
    }
  }
  console.log(`\nWiped: ${outcomes.wiped}`);
  console.log(`Refused: ${outcomes.has_row} have a row, ${outcomes.id_mismatch} id mismatch`);
  console.log(`Failed: ${outcomes.failed} (may still be there, re-run to retry)`);
  if (outcomes.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
