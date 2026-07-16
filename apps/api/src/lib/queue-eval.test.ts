import { describe, expect, it, vi } from "vitest";
import { queueSkillEval } from "./queue-eval";

describe("queueSkillEval", () => {
  it("dedupes queued evals for the same version", async () => {
    const send = vi.fn();
    const env = { AI_QUEUE: { send } } as never;
    const insertReturning = vi
      .fn()
      .mockResolvedValueOnce([{ id: "eval-1", status: "queued" }]);
    const selectLimit = vi
      .fn()
      .mockResolvedValueOnce([{ id: "eval-existing", status: "running" }]);

    const db = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: selectLimit,
          }),
        }),
      })),
      insert: vi.fn(() => ({
        values: () => ({
          returning: insertReturning,
        }),
      })),
    } as never;

    const result = await queueSkillEval(env, db, {
      skillId: "skill-1",
      versionId: "version-1",
      orgSlug: "skillist",
      skillSlug: "roll-dice",
    });

    expect(result).toEqual({
      evalId: "eval-existing",
      status: "running",
      created: false,
    });
    expect(send).not.toHaveBeenCalled();
    expect(insertReturning).not.toHaveBeenCalled();
  });
});
