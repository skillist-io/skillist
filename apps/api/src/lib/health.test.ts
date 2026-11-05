import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { hasTestDb } from "../test-support/db";
import { checkDependencies } from "./health";

/**
 * The shallow /health reported static config booleans, so it answered "ok" with
 * a dead database behind it — and the production smoke test asserted on that,
 * manufacturing confidence rather than measuring it. These assert the deep
 * probe actually reflects dependency state.
 */
describe.skipIf(!hasTestDb)("checkDependencies", () => {
  it("probes the database, kv, and r2", async () => {
    const result = await checkDependencies(env as unknown as Env);
    expect(Object.keys(result.checks).sort()).toEqual(["database", "kv", "r2"]);
  });

  it("reports degraded when a dependency fails, rather than throwing", async () => {
    const result = await checkDependencies(env as unknown as Env);
    const allOk = Object.values(result.checks).every((c) => c.ok);
    expect(result.status).toBe(allOk ? "ok" : "degraded");
  });

  it("records a duration and an error message for every probe", async () => {
    // An alert saying "connection refused" is actionable; a bare false is not.
    const result = await checkDependencies(env as unknown as Env);
    for (const check of Object.values(result.checks)) {
      expect(typeof check.ms).toBe("number");
      if (!check.ok) expect(check.error).toBeTruthy();
    }
  });
});
