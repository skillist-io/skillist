import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { composeAgentName } from "../../agent/agent-name";
import type { SkillistAgent } from "../../agent/skillist-agent";
import {
  CHAT_MESSAGES_SQL,
  CHAT_STATE_SQL,
  classifyChat,
  MESSAGE_TABLE_SQL,
  parseChatState,
  purgeChat,
  unclaimedObjectIds,
} from "./orphan-chats";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const identity = { orgId: "org", userId: "user", chatId: "chat" };

async function seedChat() {
  const ns = env.SKILLIST_AGENT;
  const parts = { orgId: crypto.randomUUID(), userId: "user-1", chatId: crypto.randomUUID() };
  const id = ns.idFromName(composeAgentName(parts.orgId, parts.userId, parts.chatId));
  await runInDurableObject(ns.get(id), async (agent: SkillistAgent) => {
    agent.setState({ ...agent.state, ...parts });
    await agent.persistMessages([
      { id: "m1", role: "user", parts: [{ type: "text", text: "a private question" }] },
    ]);
  });
  return { ns, id, parts, objectId: id.toString() };
}

describe("classifyChat", () => {
  const stored = { identity, messages: 2, lastMessageAt: NOW - 48 * HOUR };

  it("calls a quiet transcript with no row an orphan", () => {
    expect(classifyChat(stored, NOW, 24 * HOUR)).toBe("orphan");
  });

  it("leaves a chat that was never used", () => {
    expect(classifyChat({ ...stored, messages: 0 }, NOW, 24 * HOUR)).toBe("empty");
  });

  it("leaves a chat that could be mid first turn", () => {
    expect(classifyChat({ ...stored, lastMessageAt: NOW - HOUR }, NOW, 24 * HOUR)).toBe("recent");
  });

  it("treats a transcript it can't date as recent", () => {
    expect(classifyChat({ ...stored, lastMessageAt: null }, NOW, 24 * HOUR)).toBe("recent");
  });

  it("never offers a chat it can't name", () => {
    expect(classifyChat({ ...stored, identity: null }, NOW, 24 * HOUR)).toBe("unidentified");
  });
});

describe("parseChatState", () => {
  it("needs all three ids", () => {
    expect(parseChatState(JSON.stringify(identity))).toEqual(identity);
    expect(parseChatState(JSON.stringify({ ...identity, userId: null }))).toBeNull();
  });

  it("survives what isn't state", () => {
    expect(parseChatState("not json")).toBeNull();
    expect(parseChatState(null)).toBeNull();
  });
});

/** The script sends these over the query API, so they run here against a real object. */
describe("the statements the script reads with", () => {
  it("finds the identity and the transcript", async () => {
    const { ns, id, parts } = await seedChat();
    const before = Date.now() - 60_000;
    await runInDurableObject(ns.get(id), async (_agent: SkillistAgent, state) => {
      const { sql } = state.storage;
      const [stateRow] = sql.exec(CHAT_STATE_SQL).toArray();
      expect(parseChatState(stateRow?.state)).toEqual(parts);

      expect(sql.exec(MESSAGE_TABLE_SQL).raw().toArray()).toEqual([[1]]);
      const [[count, lastAt]] = sql.exec(CHAT_MESSAGES_SQL).raw().toArray() as [[number, number]];
      expect(count).toBe(1);
      // Milliseconds, which the idle window assumes.
      expect(lastAt).toBeGreaterThan(before);
    });
  });
});

describe("unclaimedObjectIds", () => {
  it("returns only the ids no row names", () => {
    const ns = env.SKILLIST_AGENT;
    const row = { id: "chat-1", orgId: "org-1", userId: "user-1" };
    const claimed = ns.idFromName(composeAgentName(row.orgId, row.userId, row.id)).toString();
    const orphan = ns.idFromName(composeAgentName("org-1", "user-1", "chat-2")).toString();
    expect(unclaimedObjectIds(ns, [row], [claimed, orphan])).toEqual([orphan]);
  });

  it("matches ids whatever their case", () => {
    const ns = env.SKILLIST_AGENT;
    const row = { id: "chat-1", orgId: "org-1", userId: "user-1" };
    const claimed = ns.idFromName(composeAgentName(row.orgId, row.userId, row.id)).toString();
    expect(unclaimedObjectIds(ns, [row], [claimed.toUpperCase()])).toEqual([]);
  });
});

describe("purgeChat", () => {
  const noRow = async () => false;

  it("wipes an orphan by name", async () => {
    const { ns, id, parts, objectId } = await seedChat();
    await expect(purgeChat(ns, { ...parts, objectId }, noRow)).resolves.toBe("wiped");
    await vi.waitFor(async () => {
      const left = await runInDurableObject(
        ns.get(id),
        async (agent: SkillistAgent) => agent.messages.length,
      );
      expect(left).toBe(0);
    });
  });

  it("refuses a chat someone can still open", async () => {
    const { ns, id, parts, objectId } = await seedChat();
    await expect(purgeChat(ns, { ...parts, objectId }, async () => true)).resolves.toBe("has_row");
    const left = await runInDurableObject(
      ns.get(id),
      async (agent: SkillistAgent) => agent.messages.length,
    );
    expect(left).toBe(1);
  });

  it("refuses ids that name a different object", async () => {
    const { ns, id, parts } = await seedChat();
    const other = ns.idFromName("something-else").toString();
    const outcome = await purgeChat(ns, { ...parts, objectId: other }, noRow);
    expect(outcome).toBe("id_mismatch");
    const left = await runInDurableObject(
      ns.get(id),
      async (agent: SkillistAgent) => agent.messages.length,
    );
    expect(left).toBe(1);
  });
});
