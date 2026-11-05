import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env";
import type { AuthContext } from "./auth-middleware";
import type { WorkerDb } from "./db";
import { loadSession } from "./harness-host";
import { checkRunQuota, RunQuotaExceededError } from "./run-quota";
import { assertSkillRunAccess } from "./skill-execution-access";
import {
  getPublishedBundle,
  runSkillScript,
  SkillExecutionBlockedError,
  SkillNotFoundError,
} from "./skill-runner";

vi.mock("./skill-execution-access", () => ({ assertSkillRunAccess: vi.fn() }));
vi.mock("./run-quota", async (original) => ({
  ...(await original<typeof import("./run-quota")>()),
  checkRunQuota: vi.fn(),
}));
vi.mock("./skill-runner", async (original) => ({
  ...(await original<typeof import("./skill-runner")>()),
  getPublishedBundle: vi.fn(),
  runSkillScript: vi.fn(),
}));

const org = { id: "org-1", slug: "acme", executionPolicy: null };
const skill = { id: "skill-1", orgId: "org-1", repo: "deploy", runtime: "sandbox" };
const skillMd = "---\nname: deploy\ndescription: Deploy things\n---\nBody\n";
const allowed = { ok: true, actorId: "u", actorType: "user", isAnonymous: false } as const;

/** Answers the two lookups `loadSkill` makes, org then skill, for each skill in turn. */
function fakeDb(): WorkerDb {
  let call = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [call++ % 2 === 0 ? org : skill] }),
      }),
    }),
    insert: () => ({ values: vi.fn(async () => undefined) }),
  } as unknown as WorkerDb;
}

const env = {} as Env;
const auth = { userId: "u" } as AuthContext;
const load = (refs = ["acme/deploy"]) => loadSession(env, fakeDb(), auth, refs);

beforeEach(() => {
  vi.mocked(assertSkillRunAccess).mockReset().mockResolvedValue(allowed);
  vi.mocked(checkRunQuota)
    .mockReset()
    .mockResolvedValue({ ok: true } as never);
  vi.mocked(runSkillScript).mockReset();
  vi.mocked(getPublishedBundle)
    .mockReset()
    .mockResolvedValue({
      bundle: new Map([
        ["SKILL.md", skillMd],
        ["scripts/go.sh", "echo hi"],
      ]),
      skill,
      version: { securityStatus: "pass" },
    } as never);
});

describe("loadSession", () => {
  it("loads a skill the caller may view", async () => {
    const { catalog, missing } = await load();
    expect(missing).toEqual([]);
    expect(catalog.get("acme/deploy")?.scripts).toEqual(["scripts/go.sh"]);
  });

  it("asks for view access, not run access, to list a skill", async () => {
    await load();
    expect(vi.mocked(assertSkillRunAccess).mock.calls[0]?.[4]).toBe("view");
  });

  it("drops a skill the caller can't see", async () => {
    vi.mocked(assertSkillRunAccess).mockResolvedValue({ ok: false, status: 404 });
    const { catalog, missing } = await load();
    expect(catalog.listed()).toEqual([]);
    expect(missing).toEqual(["acme/deploy"]);
  });

  it("drops a version that failed its security scan", async () => {
    vi.mocked(getPublishedBundle).mockResolvedValue({
      bundle: new Map([["SKILL.md", skillMd]]),
      skill,
      version: { securityStatus: "fail" },
    } as never);
    expect((await load()).missing).toEqual(["acme/deploy"]);
  });

  it("treats an unpublished skill as missing but lets real failures through", async () => {
    vi.mocked(getPublishedBundle).mockRejectedValueOnce(new SkillNotFoundError("gone"));
    expect((await load()).missing).toEqual(["acme/deploy"]);

    vi.mocked(getPublishedBundle).mockRejectedValueOnce(new Error("R2 down"));
    await expect(load()).rejects.toThrow("R2 down");
  });

  it("offers no scripts for a local-only skill", async () => {
    const localDb = fakeDb();
    const selectLocal = localDb.select;
    let call = 0;
    localDb.select = (() => {
      const isSkillLookup = call++ % 2 === 1;
      if (!isSkillLookup) return (selectLocal as () => unknown)();
      return {
        from: () => ({
          where: () => ({ limit: async () => [{ ...skill, runtime: "local" }] }),
        }),
      };
    }) as never;
    const { catalog } = await loadSession(env, localDb, auth, ["acme/deploy"]);
    expect(catalog.get("acme/deploy")?.scripts).toEqual([]);
  });

  it("rejects a malformed ref without touching the database", async () => {
    const { missing } = await load(["no-slash", "a/b/c"]);
    expect(missing).toEqual(["no-slash", "a/b/c"]);
    expect(assertSkillRunAccess).not.toHaveBeenCalled();
  });
});

describe("host.runScript", () => {
  const run = async () => (await load()).host.runScript("acme/deploy", "scripts/go.sh", ["x"]);

  it("re-checks run access at call time and spends nothing when denied", async () => {
    vi.mocked(assertSkillRunAccess)
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce({ ok: false, status: 403 });
    expect(await run()).toEqual({ ok: false, error: "not_permitted" });
    expect(runSkillScript).not.toHaveBeenCalled();
    expect(vi.mocked(assertSkillRunAccess).mock.calls[1]?.[4]).toBeUndefined();
  });

  it("stops at the quota pre-check", async () => {
    vi.mocked(checkRunQuota).mockResolvedValue({ ok: false, message: "no" } as never);
    expect(await run()).toEqual({ ok: false, error: "quota_exceeded" });
    expect(runSkillScript).not.toHaveBeenCalled();
  });

  it("runs as the caller, under the owner org's policy", async () => {
    vi.mocked(runSkillScript).mockResolvedValue({
      runId: "r",
      exitCode: 0,
      stdout: "out",
      stderr: "",
    } as never);
    expect(await run()).toMatchObject({ ok: true, runId: "r", stdout: "out" });
    expect(vi.mocked(runSkillScript).mock.calls[0]?.[2]).toMatchObject({
      orgSlug: "acme",
      skillRepo: "deploy",
      scriptPath: "scripts/go.sh",
      args: ["x"],
      actorId: "u",
      isAnonymous: false,
    });
  });

  it("maps failures to fixed codes and never leaks exception text", async () => {
    const leak = "connect ECONNREFUSED postgres://user:hunter2@db";
    vi.mocked(runSkillScript).mockRejectedValueOnce(new Error(leak));
    const result = await run();
    expect(result).toEqual({ ok: false, error: "script_failed" });
    expect(JSON.stringify(result)).not.toContain("hunter2");

    vi.mocked(runSkillScript).mockRejectedValueOnce(new SkillExecutionBlockedError("x"));
    expect(await run()).toEqual({ ok: false, error: "blocked_by_security_scan" });

    vi.mocked(runSkillScript).mockRejectedValueOnce(new RunQuotaExceededError("x" as never));
    expect(await run()).toEqual({ ok: false, error: "quota_exceeded" });
  });
});

describe("host.readFile", () => {
  it("reads only from the loaded bundle", async () => {
    const { host } = await load();
    expect(await host.readFile("acme/deploy", "scripts/go.sh")).toBe("echo hi");
    expect(await host.readFile("acme/deploy", "nope")).toBeNull();
    expect(await host.readFile("other/skill", "SKILL.md")).toBeNull();
  });
});

describe("host.onActivate", () => {
  it("swallows a telemetry failure", async () => {
    const db = fakeDb();
    db.insert = (() => ({
      values: async () => {
        throw new Error("db down");
      },
    })) as never;
    const { host } = await loadSession(env, db, auth, ["acme/deploy"]);
    await expect(host.onActivate?.("acme/deploy")).resolves.toBeUndefined();
  });
});
