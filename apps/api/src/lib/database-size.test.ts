import { describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { checkDatabaseSize } from "./database-size";
import { isTransientD1Error } from "./db";

const GB = 1024 ** 3;

function fakeEnv(bytes: number) {
  const send = vi.fn().mockResolvedValue(undefined);
  const kv = new Map<string, string>();
  return {
    send,
    env: {
      BETTER_AUTH_URL: "https://api.skillist.dev",
      ALERT_EMAIL_TO: "alerts@skillist.dev",
      EMAIL: { send },
      SKILLS_KV: {
        get: async (key: string) => kv.get(key) ?? null,
        put: async (key: string, value: string) => void kv.set(key, value),
      },
      DB: { prepare: () => ({ run: async () => ({ meta: { size_after: bytes } }) }) },
    } as unknown as Env,
  };
}

describe("checkDatabaseSize", () => {
  it("stays quiet with room to spare", async () => {
    const { env, send } = fakeEnv(6 * GB);
    await checkDatabaseSize(env);
    expect(send).not.toHaveBeenCalled();
  });

  it("alerts well before the cap", async () => {
    const { env, send } = fakeEnv(7.5 * GB);
    await checkDatabaseSize(env);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("isTransientD1Error", () => {
  it.each([
    "D1_ERROR: D1 DB is overloaded. Too many requests queued.",
    "D1_ERROR: D1 DB is overloaded. Requests queued for too long.",
    "D1_ERROR: Network connection lost.",
    "D1_ERROR: Internal error in D1 DB storage caused object to be reset.",
    "D1_ERROR: D1 DB reset because its code was updated.",
  ])("retries %s", (message) => {
    expect(isTransientD1Error(new Error(message))).toBe(true);
  });

  it("finds it through Drizzle's wrapper", () => {
    const cause = new Error("D1_ERROR: D1 DB is overloaded. Too many requests queued.");
    expect(isTransientD1Error(new Error("Failed query: select 1", { cause }))).toBe(true);
  });

  it("leaves real failures as 500s", () => {
    expect(isTransientD1Error(new Error("D1_ERROR: UNIQUE constraint failed: skills.repo"))).toBe(
      false,
    );
    expect(isTransientD1Error(new Error("D1_ERROR: no such column: x"))).toBe(false);
    expect(isTransientD1Error("D1 DB is overloaded")).toBe(false);
  });
});
