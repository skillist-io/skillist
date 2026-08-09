import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import { alertUnhandledError, fingerprint, routeShape } from "./alert";
import { describeError } from "./error-detail";

const CTX = {
  correlationId: "9a1b2c3d4e5f",
  method: "GET",
  path: "/v1/orgs/fc02aaed-7728-44ce-b30a-80a690240e60/observability",
};

/** In-memory stand-in for SKILLS_KV, enough for the dedupe reads/writes. */
function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function fakeEnv(overrides: Partial<Env> = {}) {
  return {
    // Production-looking, so the isProductionEnv guard lets alerts through.
    BETTER_AUTH_URL: "https://api.skillist.io",
    SKILLS_KV: fakeKv(),
    EMAIL: { send: vi.fn().mockResolvedValue(undefined) },
    ALERT_EMAIL_TO: "alerts@skillist.io",
    ALERT_SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/xxx",
    ...overrides,
  } as unknown as Env;
}

const dbError = () =>
  new DrizzleQueryError(
    'select "id", "org_id" from "skills" where "org_id" = $1',
    ["fc02aaed-7728-44ce-b30a-80a690240e60", "cloudflare-deploy"],
    Object.assign(new Error("write CONNECTION_CLOSED"), {
      code: "CONNECTION_CLOSED",
      severity: "FATAL",
    }),
  );

describe("routeShape", () => {
  it("collapses ids so one broken route is one fingerprint", () => {
    expect(routeShape(CTX.path)).toBe("/v1/orgs/{id}/observability");
  });

  it("collapses long opaque segments", () => {
    expect(routeShape("/v1/thing/0123456789abcdef0123")).toBe("/v1/thing/{hash}");
  });

  it("leaves ordinary path segments alone", () => {
    expect(routeShape("/skillist/cloudflare-deploy/scripts")).toBe(
      "/skillist/cloudflare-deploy/scripts",
    );
  });
});

describe("fingerprint", () => {
  it("is stable across orgs but distinct across faults", () => {
    const a = "/v1/orgs/fc02aaed-7728-44ce-b30a-80a690240e60/observability";
    const b = "/v1/orgs/5859052d-ce2b-435d-a2b7-e2641c2b0933/observability";
    expect(fingerprint(a, describeError(dbError()))).toBe(fingerprint(b, describeError(dbError())));

    const other = new DrizzleQueryError(
      "insert",
      [],
      Object.assign(new Error("dupe"), { code: "23505" }),
    );
    expect(fingerprint(a, describeError(other))).not.toBe(fingerprint(a, describeError(dbError())));
  });
});

describe("alertUnhandledError", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
  });

  it("sends to both channels", async () => {
    const env = fakeEnv();
    await alertUnhandledError(env, dbError(), CTX);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(env.EMAIL.send).toHaveBeenCalledTimes(1);
  });

  it("never puts SQL, params, or message text into an outbound alert", async () => {
    const env = fakeEnv();
    await alertUnhandledError(env, dbError(), CTX);

    const slackBody = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const emailArgs = JSON.stringify(
      (env.EMAIL.send as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0],
    );

    for (const payload of [slackBody, emailArgs]) {
      // The query and its bound params must not leave the platform.
      expect(payload).not.toContain("select");
      expect(payload).not.toContain("fc02aaed");
      expect(payload).not.toContain("cloudflare-deploy");
      // The identifiers that make it actionable must.
      expect(payload).toContain("CONNECTION_CLOSED");
      expect(payload).toContain("9a1b2c3d4e5f");
      expect(payload).toContain("/v1/orgs/{id}/observability");
    }
  });

  it("suppresses a repeat of the same fault within the window", async () => {
    const env = fakeEnv();
    await alertUnhandledError(env, dbError(), CTX);
    await alertUnhandledError(env, dbError(), CTX);
    await alertUnhandledError(env, dbError(), CTX);

    expect(env.EMAIL.send).toHaveBeenCalledTimes(1);
  });

  it("still alerts for a different fault on the same route", async () => {
    const env = fakeEnv();
    await alertUnhandledError(env, dbError(), CTX);
    await alertUnhandledError(
      env,
      new DrizzleQueryError("insert", [], Object.assign(new Error("d"), { code: "23505" })),
      CTX,
    );

    expect(env.EMAIL.send).toHaveBeenCalledTimes(2);
  });

  it("stops at the global budget so an outage cannot mass-mail", async () => {
    const env = fakeEnv();
    for (let i = 0; i < 25; i++) {
      const err = new DrizzleQueryError(
        "select 1",
        [],
        Object.assign(new Error("boom"), { code: `CODE_${i}` }),
      );
      await alertUnhandledError(env, err, CTX);
    }

    expect((env.EMAIL.send as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(10);
  });

  it("is silent outside production", async () => {
    const env = fakeEnv({ BETTER_AUTH_URL: "http://localhost:8787" } as Partial<Env>);
    await alertUnhandledError(env, dbError(), CTX);

    expect(fetch).not.toHaveBeenCalled();
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });

  it("is silent when neither channel is configured", async () => {
    const env = fakeEnv({ ALERT_EMAIL_TO: undefined, ALERT_SLACK_WEBHOOK_URL: undefined });
    await alertUnhandledError(env, dbError(), CTX);

    expect(fetch).not.toHaveBeenCalled();
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });

  it("delivers to email even when Slack fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("slack down")));
    const env = fakeEnv();

    await alertUnhandledError(env, dbError(), CTX);

    expect(env.EMAIL.send).toHaveBeenCalledTimes(1);
  });

  it("never throws, whatever the transport does", async () => {
    const env = fakeEnv({
      SKILLS_KV: {
        get: () => Promise.reject(new Error("kv exploded")),
        put: () => Promise.reject(new Error("kv exploded")),
      },
    } as unknown as Partial<Env>);

    await expect(alertUnhandledError(env, dbError(), CTX)).resolves.toBeUndefined();
  });
});
