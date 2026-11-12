import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import type { WorkerDb } from "./db";
import {
  isSkillExecutionDisabled,
  runSkillScript,
  SkillExecutionDisabledError,
} from "./skill-runner";

describe("SKILL_EXECUTION_DISABLED kill switch", () => {
  it("counts any spelling of true as on", () => {
    for (const value of ["true", "TRUE", " 1 ", "yes", "on"]) {
      expect(isSkillExecutionDisabled({ SKILL_EXECUTION_DISABLED: value })).toBe(true);
    }
  });

  it("is off when unset or set to anything else", () => {
    for (const value of [undefined, "", "false", "0", "off"]) {
      expect(isSkillExecutionDisabled({ SKILL_EXECUTION_DISABLED: value })).toBe(false);
    }
  });

  it("refuses a run before touching the database", async () => {
    // A db that throws on any use proves nothing ran before the check.
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error("the database must not be touched");
        },
      },
    ) as WorkerDb;
    const env = { SKILL_EXECUTION_DISABLED: "true" } as Env;
    await expect(
      runSkillScript(env, db, { orgSlug: "o", skillRepo: "r", scriptPath: "scripts/a.sh" }),
    ).rejects.toBeInstanceOf(SkillExecutionDisabledError);
  });
});
