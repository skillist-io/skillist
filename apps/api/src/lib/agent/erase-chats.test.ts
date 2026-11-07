import { env, runInDurableObject } from "cloudflare:test";
import { agentChats } from "@skillist/db/schema";
import { describe, expect, it, vi } from "vitest";
import { composeAgentName } from "../../agent/agent-name";
import type { SkillistAgent } from "../../agent/skillist-agent";
import { cleanup, hasTestDb, seedOrg, seedUser, withDb } from "../../test-support/db";
import type { WorkerDb } from "../db";
import { eraseAgentChats } from "./erase-chats";

const ns = () => env.SKILLIST_AGENT;
const stubFor = (orgId: string, userId: string, chatId: string) =>
  ns().get(ns().idFromName(composeAgentName(orgId, userId, chatId)));

async function seedChat(db: WorkerDb, orgId: string, userId: string) {
  const chatId = crypto.randomUUID();
  await db.insert(agentChats).values({ id: chatId, orgId, userId, title: "t" });
  await runInDurableObject(stubFor(orgId, userId, chatId), async (agent: SkillistAgent) => {
    await agent.persistMessages([
      { id: "m1", role: "user", parts: [{ type: "text", text: "a private question" }] },
    ]);
  });
  return chatId;
}

const messagesIn = (orgId: string, userId: string, chatId: string) =>
  runInDurableObject(
    stubFor(orgId, userId, chatId),
    async (agent: SkillistAgent) => agent.messages.length,
  );

describe.skipIf(!hasTestDb)("eraseAgentChats", () => {
  it("wipes the user's chats everywhere and every chat in a deleted org, and nobody else's", async () => {
    await withDb(async (raw) => {
      const db = raw as unknown as WorkerDb;
      const leaving = await seedUser(raw);
      const former = await seedUser(raw);
      const stays = await seedUser(raw);
      // `solo` goes with the user. `shared` survives, with `stays` still in it.
      const solo = await seedOrg(raw, leaving.id);
      const shared = await seedOrg(raw, stays.id, [{ userId: leaving.id, role: "viewer" }]);
      try {
        const own = await seedChat(db, shared.id, leaving.id);
        const ownSolo = await seedChat(db, solo.id, leaving.id);
        // A former member's chat: its row cascades with the org, so it must go too.
        const formerInSolo = await seedChat(db, solo.id, former.id);
        const other = await seedChat(db, shared.id, stays.id);

        const result = await eraseAgentChats(db, ns(), {
          userId: leaving.id,
          orgIds: [solo.id],
        });
        expect(result).toEqual({ wiped: 3, failed: 0 });

        // Read through a fresh instance, which is what anyone reopening it would get.
        await vi.waitFor(async () => {
          expect(await messagesIn(shared.id, leaving.id, own)).toBe(0);
          expect(await messagesIn(solo.id, leaving.id, ownSolo)).toBe(0);
          expect(await messagesIn(solo.id, former.id, formerInSolo)).toBe(0);
        });
        expect(await messagesIn(shared.id, stays.id, other)).toBe(1);
      } finally {
        await cleanup(raw, {
          orgs: [solo.id, shared.id],
          users: [leaving.id, former.id, stays.id],
        });
      }
    });
  });

  it("only touches the user's own chats when no org goes with them", async () => {
    await withDb(async (raw) => {
      const db = raw as unknown as WorkerDb;
      const leaving = await seedUser(raw);
      const stays = await seedUser(raw);
      const org = await seedOrg(raw, stays.id, [{ userId: leaving.id, role: "viewer" }]);
      try {
        const other = await seedChat(db, org.id, stays.id);
        const result = await eraseAgentChats(db, ns(), { userId: leaving.id, orgIds: [] });
        expect(result).toEqual({ wiped: 0, failed: 0 });
        expect(await messagesIn(org.id, stays.id, other)).toBe(1);
      } finally {
        await cleanup(raw, { orgs: [org.id], users: [leaving.id, stays.id] });
      }
    });
  });
});
