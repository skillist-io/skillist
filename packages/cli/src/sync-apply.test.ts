import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Lockfile } from "./lockfile.js";
import {
  applySync,
  DEFAULT_CONFIG,
  listMaterialized,
  type Manifest,
  planSync,
  type ResolvedSkill,
  readStoreKeys,
  type SyncDeps,
  type SyncTarget,
} from "./sync.js";

const SKILL_MD = `---
name: widget
description: A widget skill for testing sync materialization end to end.
---

# Widget
`;

let cwd: string;
let target: SyncTarget;
let activations: Array<{ repo: string; harness: string; scope: string }>;
let fetched: string[];

const skill: ResolvedSkill = {
  org: "acme",
  repo: "widget",
  name: "widget",
  version: "1.0.0",
  contentSha256: "deadbeef",
};

function deps(): SyncDeps {
  return {
    fetchMeta: async () => ({ version: "1.0.0" }),
    fetchBundle: async (org, repo, version) => {
      fetched.push(`${org}/${repo}@${version}`);
      return { files: { "SKILL.md": SKILL_MD, "scripts/run.sh": "echo hi\n" }, version };
    },
    enforcePolicy: async () => {},
    recordActivation: async (_org, repo, harness, scope) => {
      activations.push({ repo, harness, scope });
    },
  };
}

async function reconcile(
  manifest: Manifest,
  options: { prune?: boolean; force?: boolean; desired?: ResolvedSkill[] } = {},
) {
  const desired = options.desired ?? [skill];
  const actions = planSync({
    desired,
    targets: [target],
    manifest,
    actual: await listMaterialized([target]),
    storeKeys: await readStoreKeys(cwd),
    prune: options.prune ?? false,
    force: options.force ?? false,
  });
  return { actions, desired };
}

async function apply(
  manifest: Manifest,
  lock: Lockfile,
  options: { prune?: boolean; force?: boolean; desired?: ResolvedSkill[] } = {},
) {
  const { actions, desired } = await reconcile(manifest, options);
  const result = await applySync(
    actions,
    {
      cwd,
      desired,
      targets: [target],
      manifest,
      lock,
      config: DEFAULT_CONFIG,
      scope: "project",
      linkMode: "copy",
      prune: options.prune ?? false,
    },
    deps(),
  );
  return { actions, result };
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "skillist-sync-"));
  target = { dir: ".claude/skills", abs: join(cwd, ".claude/skills"), harness: "claude" };
  activations = [];
  fetched = [];
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("applySync", () => {
  it("fetches into the store, materializes into the target, and records ownership", async () => {
    const manifest: Manifest = { version: 1, entries: [] };
    const lock: Lockfile = { version: 1, skills: [] };
    const { actions, result } = await apply(manifest, lock);

    expect(actions.map((a) => a.kind)).toEqual(["fetch", "create"]);
    expect(fetched).toEqual(["acme/widget@1.0.0"]);

    // Materialized, including nested bundle files.
    expect(await readFile(join(target.abs, "widget/SKILL.md"), "utf8")).toBe(SKILL_MD);
    expect(await readFile(join(target.abs, "widget/scripts/run.sh"), "utf8")).toBe("echo hi\n");

    // Store is populated under the key the planner looks for.
    expect(await readStoreKeys(cwd)).toEqual(new Set(["acme/widget@1.0.0"]));

    expect(result.manifest.entries).toHaveLength(1);
    expect(result.manifest.entries[0]).toMatchObject({
      path: ".claude/skills/widget",
      org: "acme",
      repo: "widget",
      version: "1.0.0",
      target: ".claude/skills",
      harness: "claude",
    });

    expect(lock.skills).toEqual([
      expect.objectContaining({ org: "acme", repo: "widget", version: "1.0.0" }),
    ]);
    expect(activations).toEqual([{ repo: "widget", harness: "claude", scope: "project" }]);
  });

  it("is idempotent — a second reconcile plans nothing", async () => {
    const lock: Lockfile = { version: 1, skills: [] };
    const first = await apply({ version: 1, entries: [] }, lock);
    const second = await reconcile(first.result.manifest);
    expect(second.actions).toEqual([]);
  });

  it("detects a local edit and restores it under force", async () => {
    const lock: Lockfile = { version: 1, skills: [] };
    const first = await apply({ version: 1, entries: [] }, lock);

    await writeFile(join(target.abs, "widget/SKILL.md"), `${SKILL_MD}\nlocal edit\n`, "utf8");

    const drifted = await reconcile(first.result.manifest);
    expect(drifted.actions).toEqual([
      {
        kind: "conflict",
        ref: "acme/widget",
        path: ".claude/skills/widget",
        reason: "local-edit",
      },
    ]);

    const forced = await apply(first.result.manifest, lock, { force: true });
    expect(forced.actions.map((a) => a.kind)).toEqual(["restore"]);
    expect(await readFile(join(target.abs, "widget/SKILL.md"), "utf8")).toBe(SKILL_MD);

    expect((await reconcile(forced.result.manifest)).actions).toEqual([]);
  });

  it("replaces stale files on version change rather than merging them", async () => {
    const lock: Lockfile = { version: 1, skills: [] };
    const first = await apply({ version: 1, entries: [] }, lock);

    const next: ResolvedSkill = { ...skill, version: "2.0.0" };
    const second = await apply(first.result.manifest, lock, { desired: [next] });

    expect(second.actions.map((a) => a.kind)).toEqual(["fetch", "update"]);
    expect(second.result.manifest.entries[0]?.version).toBe("2.0.0");
    expect(lock.skills[0]?.version).toBe("2.0.0");
  });

  it("prunes only what the manifest owns", async () => {
    const lock: Lockfile = { version: 1, skills: [] };
    const first = await apply({ version: 1, entries: [] }, lock);

    // A hand-written skill sitting in the same target directory.
    await mkdir(join(target.abs, "handwritten"), { recursive: true });
    await writeFile(
      join(target.abs, "handwritten/SKILL.md"),
      SKILL_MD.replaceAll("widget", "handwritten"),
      "utf8",
    );

    // Desire nothing: the managed skill prunes, the hand-written one does not.
    const { actions, result } = await apply(first.result.manifest, lock, {
      prune: true,
      desired: [],
    });

    expect(actions).toEqual([
      { kind: "prune", path: ".claude/skills/widget" },
      { kind: "untracked", path: ".claude/skills/handwritten" },
    ]);
    expect(result.manifest.entries).toEqual([]);
    await expect(readFile(join(target.abs, "widget/SKILL.md"), "utf8")).rejects.toThrow();
    expect(await readFile(join(target.abs, "handwritten/SKILL.md"), "utf8")).toContain("name:");
  });
});
