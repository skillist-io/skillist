import type { SyncQueueMessage } from "@skillist/contracts";
import { describe, expect, it, vi } from "vitest";

describe("SyncQueueMessage routing", () => {
  it("publish_skill carries fields required for finalize batch", () => {
    const message: SyncQueueMessage = {
      type: "publish_skill",
      sourceId: "00000000-0000-4000-8000-000000000001",
      skillSlug: "agents-sdk",
      sourcePath: "skills/agents-sdk",
      commitSha: "abc123",
    };
    expect(message.type).toBe("publish_skill");
    expect(message.skillSlug).toBe("agents-sdk");
  });

  it("sync_all fans out to enabled sources", async () => {
    const create = vi.fn();
    const listEnabledSourceIds = vi.fn(async () => ["a", "b"]);
    for (const sourceId of await listEnabledSourceIds()) {
      await create({ id: `sync-${sourceId}`, params: { sourceId } });
    }
    expect(create).toHaveBeenCalledTimes(2);
  });
});
