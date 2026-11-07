import { env, runInDurableObject } from "cloudflare:test";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { composeAgentName } from "./agent-name";
import { wipeChat } from "./chat-delete";
import type { SkillistAgent } from "./skillist-agent";

const text = (id: string, role: "user" | "assistant", body: string): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text: body }],
});

/**
 * The delete dialog promises a transcript is gone for good. `persistMessages([])`
 * looked like it kept that promise and removed nothing, so this reads the transcript
 * back through a fresh instance, which is what reopening the chat does.
 */
describe("SkillistAgent.cleanup", () => {
  it("leaves nothing behind for a reconnect to read", async () => {
    const ns = env.SKILLIST_AGENT;
    const id = ns.idFromName(composeAgentName(crypto.randomUUID(), "user-1", crypto.randomUUID()));

    await runInDurableObject(ns.get(id), async (agent: SkillistAgent) => {
      await agent.persistMessages([
        text("m1", "user", "a private question"),
        text("m2", "assistant", "a private answer"),
      ]);
      expect(agent.messages).toHaveLength(2);
    });

    await wipeChat(ns.get(id));

    // A stub reaching the object mid-abort fails with "destroyed", which is the object
    // going away, not a read of it. A reconnect comes later, on a fresh instance.
    await vi.waitFor(async () => {
      const left = await runInDurableObject(
        ns.get(id),
        async (agent: SkillistAgent) => agent.messages.length,
      );
      expect(left).toBe(0);
    });
  });

  it("reports a wipe that really failed", async () => {
    const failing = { cleanup: () => Promise.reject(new Error("storage unavailable")) };
    await expect(wipeChat(failing)).rejects.toThrow("storage unavailable");
  });

  it("treats the object's own abort as done", async () => {
    const aborting = { cleanup: () => Promise.reject(new Error("destroyed")) };
    await expect(wipeChat(aborting)).resolves.toBeUndefined();
  });
});

describe("SkillistAgent.noteDecision", () => {
  it("adds the line, marked so the transcript can tell it from a reply", async () => {
    const ns = env.SKILLIST_AGENT;
    const id = ns.idFromName(composeAgentName(crypto.randomUUID(), "user-1", crypto.randomUUID()));
    await ns.get(id).noteDecision("Denied by you. Nothing ran.");

    await runInDurableObject(ns.get(id), async (agent: SkillistAgent) => {
      const line = agent.messages.at(-1);
      expect(line?.metadata).toEqual({ decision: true });
      expect(line?.parts).toEqual([{ type: "text", text: "Denied by you. Nothing ran." }]);
    });
  });
});
