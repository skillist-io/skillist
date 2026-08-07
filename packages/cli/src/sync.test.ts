import { describe, expect, it } from "vitest";
import {
  assertNoCollisions,
  hasDrift,
  type Manifest,
  type ManifestEntry,
  type PlanInput,
  planSync,
  type ResolvedSkill,
  type SyncTarget,
  satisfiesRange,
  storeKey,
  summarize,
} from "./sync.js";

const CLAUDE: SyncTarget = { dir: ".claude/skills", abs: "/p/.claude/skills", harness: "claude" };
const CURSOR: SyncTarget = { dir: ".cursor/skills", abs: "/p/.cursor/skills", harness: "cursor" };

function skill(overrides: Partial<ResolvedSkill> = {}): ResolvedSkill {
  return {
    org: "acme",
    repo: "widget",
    name: "widget",
    version: "1.0.0",
    ...overrides,
  };
}

function owned(path: string, overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    path,
    org: "acme",
    repo: "widget",
    version: "1.0.0",
    dirHash: "hash-1",
    target: path.slice(0, path.lastIndexOf("/")),
    harness: "claude",
    writtenAt: "2026-08-07T00:00:00.000Z",
    ...overrides,
  };
}

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    desired: [skill()],
    targets: [CLAUDE],
    manifest: { version: 1, entries: [] },
    actual: [],
    storeKeys: new Set([storeKey("acme", "widget", "1.0.0")]),
    prune: false,
    force: false,
    ...overrides,
  };
}

describe("planSync", () => {
  it("creates a skill missing from the target", () => {
    const actions = planSync(input());
    expect(actions).toEqual([
      {
        kind: "create",
        ref: "acme/widget",
        path: ".claude/skills/widget",
        version: "1.0.0",
        target: ".claude/skills",
      },
    ]);
  });

  it("fans a single skill out to every target", () => {
    const actions = planSync(input({ targets: [CLAUDE, CURSOR] }));
    expect(actions.map((a) => a.kind)).toEqual(["create", "create"]);
    expect(actions.map((a) => (a.kind === "create" ? a.path : ""))).toEqual([
      ".claude/skills/widget",
      ".cursor/skills/widget",
    ]);
  });

  it("fetches each missing pinned version once", () => {
    const actions = planSync(
      input({
        desired: [skill(), skill({ repo: "other", name: "other" })],
        targets: [CLAUDE, CURSOR],
        storeKeys: new Set(),
      }),
    );
    const fetches = actions.filter((a) => a.kind === "fetch");
    expect(fetches).toHaveLength(2);
    expect(fetches.map((a) => (a.kind === "fetch" ? a.ref : ""))).toEqual([
      "acme/widget",
      "acme/other",
    ]);
  });

  it("does nothing when the materialized hash matches the manifest", () => {
    const actions = planSync(
      input({
        manifest: { version: 1, entries: [owned(".claude/skills/widget")] },
        actual: [{ path: ".claude/skills/widget", dirHash: "hash-1" }],
      }),
    );
    expect(actions).toEqual([]);
    expect(hasDrift(actions)).toBe(false);
  });

  it("updates when the desired version moves", () => {
    const actions = planSync(
      input({
        desired: [skill({ version: "1.1.0" })],
        storeKeys: new Set([storeKey("acme", "widget", "1.1.0")]),
        manifest: { version: 1, entries: [owned(".claude/skills/widget")] },
        actual: [{ path: ".claude/skills/widget", dirHash: "hash-1" }],
      }),
    );
    expect(actions).toEqual([
      {
        kind: "update",
        ref: "acme/widget",
        path: ".claude/skills/widget",
        from: "1.0.0",
        to: "1.1.0",
        target: ".claude/skills",
      },
    ]);
  });

  it("reports a local edit as a conflict rather than overwriting", () => {
    const actions = planSync(
      input({
        manifest: { version: 1, entries: [owned(".claude/skills/widget")] },
        actual: [{ path: ".claude/skills/widget", dirHash: "edited" }],
      }),
    );
    expect(actions).toEqual([
      {
        kind: "conflict",
        ref: "acme/widget",
        path: ".claude/skills/widget",
        reason: "local-edit",
      },
    ]);
  });

  it("restores a local edit only under --force", () => {
    const actions = planSync(
      input({
        force: true,
        manifest: { version: 1, entries: [owned(".claude/skills/widget")] },
        actual: [{ path: ".claude/skills/widget", dirHash: "edited" }],
      }),
    );
    expect(actions.map((a) => a.kind)).toEqual(["restore"]);
  });

  it("refuses to clobber a directory it never wrote", () => {
    const actions = planSync(input({ actual: [{ path: ".claude/skills/widget", dirHash: "x" }] }));
    expect(actions).toEqual([
      {
        kind: "conflict",
        ref: "acme/widget",
        path: ".claude/skills/widget",
        reason: "unmanaged",
      },
    ]);
  });

  it("reports foreign skills as untracked without proposing changes", () => {
    const actions = planSync(
      input({
        manifest: { version: 1, entries: [owned(".claude/skills/widget")] },
        actual: [
          { path: ".claude/skills/widget", dirHash: "hash-1" },
          { path: ".claude/skills/scratch-notes", dirHash: "whatever" },
        ],
      }),
    );
    expect(actions).toEqual([{ kind: "untracked", path: ".claude/skills/scratch-notes" }]);
    expect(hasDrift(actions)).toBe(false);
  });

  it("prunes manifest-owned paths only, and only when asked", () => {
    const manifest: Manifest = {
      version: 1,
      entries: [owned(".claude/skills/widget"), owned(".claude/skills/gone", { repo: "gone" })],
    };
    const actual = [
      { path: ".claude/skills/widget", dirHash: "hash-1" },
      { path: ".claude/skills/gone", dirHash: "hash-1" },
    ];

    expect(planSync(input({ manifest, actual }))).toEqual([]);

    const pruned = planSync(input({ manifest, actual, prune: true }));
    expect(pruned).toEqual([{ kind: "prune", path: ".claude/skills/gone" }]);
  });

  it("never prunes a target that is not part of this run", () => {
    const actions = planSync(
      input({
        prune: true,
        // Only Claude is being reconciled; the Cursor materialization is
        // manifest-owned but out of scope and must survive.
        targets: [CLAUDE],
        manifest: {
          version: 1,
          entries: [
            owned(".claude/skills/widget"),
            owned(".cursor/skills/widget", { target: ".cursor/skills", harness: "cursor" }),
          ],
        },
        actual: [{ path: ".claude/skills/widget", dirHash: "hash-1" }],
      }),
    );
    expect(actions.some((a) => a.kind === "prune")).toBe(false);
  });

  it("never prunes a path the manifest does not own", () => {
    const actions = planSync(
      input({
        prune: true,
        manifest: { version: 1, entries: [owned(".claude/skills/widget")] },
        actual: [
          { path: ".claude/skills/widget", dirHash: "hash-1" },
          { path: ".claude/skills/handwritten", dirHash: "x" },
        ],
      }),
    );
    expect(actions.some((a) => a.kind === "prune")).toBe(false);
    expect(actions).toContainEqual({ kind: "untracked", path: ".claude/skills/handwritten" });
  });

  it("reports staleness without upgrading", () => {
    const actions = planSync(
      input({
        desired: [skill({ latest: "2.0.0" })],
        manifest: { version: 1, entries: [owned(".claude/skills/widget")] },
        actual: [{ path: ".claude/skills/widget", dirHash: "hash-1" }],
      }),
    );
    expect(actions).toEqual([
      { kind: "stale", ref: "acme/widget", have: "1.0.0", latest: "2.0.0" },
    ]);
    expect(hasDrift(actions)).toBe(false);
  });

  it("replaces a path whose manifest owner changed", () => {
    const actions = planSync(
      input({
        desired: [skill({ org: "other", repo: "thing", name: "widget" })],
        storeKeys: new Set([storeKey("other", "thing", "1.0.0")]),
        manifest: { version: 1, entries: [owned(".claude/skills/widget")] },
        actual: [{ path: ".claude/skills/widget", dirHash: "hash-1" }],
      }),
    );
    expect(actions.map((a) => a.kind)).toEqual(["update"]);
  });

  it("treats a missing store entry as fetch, not drift", () => {
    const actions = planSync(
      input({
        storeKeys: new Set(),
        manifest: { version: 1, entries: [owned(".claude/skills/widget")] },
        actual: [{ path: ".claude/skills/widget", dirHash: "hash-1" }],
      }),
    );
    expect(actions.map((a) => a.kind)).toEqual(["fetch"]);
    expect(hasDrift(actions)).toBe(false);
  });
});

describe("assertNoCollisions", () => {
  it("rejects two orgs materializing to the same directory name", () => {
    expect(() => assertNoCollisions([skill(), skill({ org: "other" })])).toThrow(/Name collision/);
  });

  it("accepts an explicit alias", () => {
    expect(() =>
      assertNoCollisions([skill(), skill({ org: "other", name: "other-widget" })]),
    ).not.toThrow();
  });
});

describe("satisfiesRange", () => {
  it("matches exact versions", () => {
    expect(satisfiesRange("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.4", "1.2.3")).toBe(false);
  });

  it("accepts anything for latest", () => {
    expect(satisfiesRange("9.9.9", "latest")).toBe(true);
  });

  it("applies caret semantics, including the 0.x major lock", () => {
    expect(satisfiesRange("1.9.0", "^1.2.0")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.2.0")).toBe(false);
    expect(satisfiesRange("1.1.0", "^1.2.0")).toBe(false);
    expect(satisfiesRange("0.2.9", "^0.2.0")).toBe(true);
    expect(satisfiesRange("0.3.0", "^0.2.0")).toBe(false);
  });

  it("applies tilde semantics", () => {
    expect(satisfiesRange("1.2.9", "~1.2.0")).toBe(true);
    expect(satisfiesRange("1.3.0", "~1.2.0")).toBe(false);
  });

  it("rejects ranges it cannot evaluate", () => {
    expect(() => satisfiesRange("1.0.0", ">=1.0.0")).toThrow(/Unsupported version range/);
  });
});

describe("summarize", () => {
  it("counts materializations and conflicts", () => {
    const actions = planSync(
      input({
        targets: [CLAUDE, CURSOR],
        actual: [{ path: ".cursor/skills/widget", dirHash: "x" }],
      }),
    );
    expect(summarize(actions, 2)).toBe("1 materialized · 2 targets · 1 conflict · 0 untracked");
  });
});
