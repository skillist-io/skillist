/**
 * `skillist sync` — reconcile the lockfile (desired state) into every agent
 * harness directory in the project (actual state).
 *
 * Three tiers of state, deliberately separated:
 *   skillist.json       desired      human-authored, optional
 *   .skillist.lock      resolved     exact versions + content hashes
 *   .claude/skills/…    materialized what the harness actually reads
 *
 * `.skillist/manifest.json` records every path sync owns. Nothing outside the
 * manifest is ever modified or deleted — a hand-written skill that happens to
 * sit in a target directory is reported as `untracked`, never clobbered.
 */
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { access, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { compareSemver, isBinaryAssetPath } from "@skillist/skill-format";
import { type LockEntry, type Lockfile, upsertLockEntry } from "./lockfile.js";
import { inferType, type SourceType } from "./source.js";

export const CONFIG_FILE = "skillist.json";
export const STATE_DIR = ".skillist";
export const MANIFEST_FILE = `${STATE_DIR}/manifest.json`;
export const STORE_DIR = `${STATE_DIR}/store`;

/**
 * Harness roots we will write into. The root (not the skills dir) is the
 * detection signal: the presence of `.cursor/` means the developer uses
 * Cursor, whereas creating `.cursor/` for someone who does not is noise.
 *
 * Deliberately excluded from auto-detection: `.claude/plugins/marketplaces`
 * (foreign trees owned by the plugin manager) and bare `skills/` (too generic
 * to claim) — both are writable only when named explicitly via `--target`.
 */
export const HARNESS_TARGETS = [
  { root: ".claude", dir: ".claude/skills" },
  { root: ".cursor", dir: ".cursor/skills" },
  { root: ".agents", dir: ".agents/skills" },
  { root: ".gemini", dir: ".gemini/skills" },
  { root: ".codex", dir: ".codex/skills" },
  { root: ".vscode", dir: ".vscode/skills" },
] as const;

export type SyncScope = "project" | "user";
export type LinkMode = "copy" | "symlink";

export type DesiredSkill = {
  /** `org/repo` */
  ref: string;
  /** Exact version, `latest`, or a `^`/`~` range. Omitted means latest. */
  version?: string;
  /** Directory name override, required to break a name collision. */
  as?: string;
};

export type SyncConfig = {
  version: 1;
  org?: string;
  targets: string[] | "auto";
  scope: SyncScope;
  linkMode: LinkMode;
  skills: DesiredSkill[];
};

export const DEFAULT_CONFIG: SyncConfig = {
  version: 1,
  targets: "auto",
  scope: "project",
  linkMode: "copy",
  skills: [],
};

export type SyncTarget = {
  /** Path as recorded in the manifest — relative to cwd for project scope. */
  dir: string;
  /** Absolute path on disk. */
  abs: string;
  harness: SourceType;
};

/** A desired skill after version resolution — everything the planner needs. */
export type ResolvedSkill = {
  org: string;
  repo: string;
  /** Materialized directory name. */
  name: string;
  /** Exact pinned version. */
  version: string;
  /** Latest published version, for staleness reporting. */
  latest?: string;
  contentSha256?: string;
};

export type MaterializedSkill = {
  path: string;
  dirHash: string;
};

export type ManifestEntry = {
  path: string;
  org: string;
  repo: string;
  version: string;
  /** Digest over every file in the materialized directory. */
  dirHash: string;
  target: string;
  harness: SourceType;
  writtenAt: string;
};

export type Manifest = {
  version: 1;
  entries: ManifestEntry[];
};

export type SyncAction =
  | { kind: "fetch"; ref: string; version: string }
  | { kind: "create"; ref: string; path: string; version: string; target: string }
  | { kind: "update"; ref: string; path: string; from: string; to: string; target: string }
  | { kind: "restore"; ref: string; path: string; version: string; target: string }
  | { kind: "prune"; path: string }
  | { kind: "conflict"; ref: string; path: string; reason: "local-edit" | "unmanaged" }
  | { kind: "untracked"; path: string }
  | { kind: "stale"; ref: string; have: string; latest: string };

/** Action kinds that mean the materialized tree disagrees with the lockfile. */
const DRIFT_KINDS = new Set<SyncAction["kind"]>([
  "create",
  "update",
  "restore",
  "prune",
  "conflict",
]);

export function hasDrift(actions: SyncAction[]): boolean {
  return actions.some((a) => DRIFT_KINDS.has(a.kind));
}

export function storeKey(org: string, repo: string, version: string): string {
  return `${org}/${repo}@${version}`;
}

export function storePath(org: string, repo: string, version: string): string {
  return `${STORE_DIR}/${org}/${repo}@${version}`;
}

function joinPosix(a: string, b: string): string {
  return `${a.replace(/\/+$/, "")}/${b}`;
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

// ---------------------------------------------------------------------------
// Version ranges
// ---------------------------------------------------------------------------

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Minimal caret/tilde matching. Delivery only publishes the latest version
 * (there is no public version-list endpoint), so a range can only ever resolve
 * to latest — this decides whether latest is an acceptable answer.
 */
export function satisfiesRange(version: string, range: string): boolean {
  if (range === "latest" || range === "*") return true;
  if (EXACT.test(range)) return compareSemver(version, range) === 0;

  const operator = range.slice(0, 1);
  const base = range.slice(1);
  if ((operator !== "^" && operator !== "~") || !EXACT.test(base)) {
    throw new Error(
      `Unsupported version range "${range}" — use an exact version, ^x.y.z, ~x.y.z, or latest`,
    );
  }
  if (compareSemver(version, base) < 0) return false;

  const [vMajor = 0, vMinor = 0] = version.split(".").map((n) => Number(n) || 0);
  const [bMajor = 0, bMinor = 0] = base.split(".").map((n) => Number(n) || 0);
  if (operator === "^") {
    // ^0.x.y is major-locked at the minor, matching npm semantics.
    return bMajor === 0 ? vMajor === 0 && vMinor === bMinor : vMajor === bMajor;
  }
  return vMajor === bMajor && vMinor === bMinor;
}

// ---------------------------------------------------------------------------
// Config, manifest, target detection
// ---------------------------------------------------------------------------

export async function readSyncConfig(cwd = process.cwd()): Promise<SyncConfig> {
  try {
    const raw = await readFile(join(cwd, CONFIG_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    return {
      version: 1,
      ...(parsed.org ? { org: parsed.org } : {}),
      targets: parsed.targets ?? "auto",
      scope: parsed.scope ?? "project",
      linkMode: parsed.linkMode ?? "copy",
      skills: parsed.skills ?? [],
    };
  } catch (err) {
    if (err instanceof SyntaxError)
      throw new Error(`${CONFIG_FILE} is not valid JSON: ${err.message}`);
    return { ...DEFAULT_CONFIG };
  }
}

export async function readManifest(cwd = process.cwd()): Promise<Manifest> {
  try {
    const raw = await readFile(join(cwd, MANIFEST_FILE), "utf8");
    const parsed = JSON.parse(raw) as Manifest;
    return { version: 1, entries: parsed.entries ?? [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

export async function writeManifest(manifest: Manifest, cwd = process.cwd()) {
  const path = join(cwd, MANIFEST_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Resolves configured/`auto` targets to absolute dirs plus their harness id. */
export async function resolveTargets(
  config: SyncConfig,
  options: { cwd?: string; explicit?: string[]; scope?: SyncScope } = {},
): Promise<SyncTarget[]> {
  const cwd = options.cwd ?? process.cwd();
  const scope = options.scope ?? config.scope;
  const base = scope === "user" ? homedir() : cwd;

  const dirs =
    options.explicit && options.explicit.length > 0
      ? options.explicit
      : config.targets === "auto"
        ? await detectHarnessDirs(base)
        : config.targets;

  return dirs.map((dir) => {
    const abs = resolve(base, dir);
    return {
      // User-scope paths are absolute so the manifest stays unambiguous.
      dir: scope === "user" ? toPosix(abs) : toPosix(relative(cwd, abs)) || dir,
      abs,
      harness: inferType(abs),
    };
  });
}

async function detectHarnessDirs(base: string): Promise<string[]> {
  const found: string[] = [];
  for (const target of HARNESS_TARGETS) {
    if (await exists(join(base, target.root))) found.push(target.dir);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Hashing and disk inspection
// ---------------------------------------------------------------------------

async function collectFiles(dir: string, prefix = ""): Promise<Array<[string, Buffer]>> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<[string, Buffer]> = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full, rel)));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      try {
        out.push([rel, await readFile(full)]);
      } catch {
        // unreadable file — treated as absent, surfaces as drift
      }
    }
  }
  return out;
}

/** Stable digest over every file in a materialized skill directory. */
export async function hashSkillDir(dir: string): Promise<string> {
  const files = (await collectFiles(dir)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const hash = createHash("sha256");
  for (const [path, content] of files) {
    hash.update(path);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Lists materialized skills one level below each target. Sync always writes at
 * depth 1, so a deeper hand-rolled tree is out of scope rather than untracked.
 */
export async function listMaterialized(targets: SyncTarget[]): Promise<MaterializedSkill[]> {
  const out: MaterializedSkill[] = [];
  for (const target of targets) {
    let entries: Dirent[];
    try {
      entries = await readdir(target.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const abs = join(target.abs, entry.name);
      if (!(await exists(join(abs, "SKILL.md")))) continue;
      out.push({ path: joinPosix(target.dir, entry.name), dirHash: await hashSkillDir(abs) });
    }
  }
  return out;
}

export async function readStoreKeys(cwd = process.cwd()): Promise<Set<string>> {
  const keys = new Set<string>();
  const root = join(cwd, STORE_DIR);
  let orgs: Dirent[];
  try {
    orgs = await readdir(root, { withFileTypes: true });
  } catch {
    return keys;
  }
  for (const org of orgs) {
    if (!org.isDirectory()) continue;
    let repos: Dirent[];
    try {
      repos = await readdir(join(root, org.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const repo of repos) {
      if (!repo.isDirectory()) continue;
      keys.add(`${org.name}/${repo.name}`);
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Planner (pure)
// ---------------------------------------------------------------------------

export type PlanInput = {
  desired: ResolvedSkill[];
  targets: SyncTarget[];
  manifest: Manifest;
  actual: MaterializedSkill[];
  /** `org/repo@version` keys already present in the local store. */
  storeKeys: Set<string>;
  prune: boolean;
  force: boolean;
};

export function planSync(input: PlanInput): SyncAction[] {
  const actions: SyncAction[] = [];
  const actualByPath = new Map(input.actual.map((a) => [a.path, a]));
  const manifestByPath = new Map(input.manifest.entries.map((e) => [e.path, e]));
  const desiredPaths = new Set<string>();

  // Fetch each pinned version the store is missing, once.
  const needed = new Map<string, ResolvedSkill>();
  for (const skill of input.desired) {
    const key = storeKey(skill.org, skill.repo, skill.version);
    if (!input.storeKeys.has(key) && !needed.has(key)) needed.set(key, skill);
  }
  for (const skill of needed.values()) {
    actions.push({ kind: "fetch", ref: `${skill.org}/${skill.repo}`, version: skill.version });
  }

  for (const skill of input.desired) {
    const ref = `${skill.org}/${skill.repo}`;
    for (const target of input.targets) {
      const path = joinPosix(target.dir, skill.name);
      desiredPaths.add(path);

      const owned = manifestByPath.get(path);
      const actual = actualByPath.get(path);

      if (!actual) {
        actions.push({ kind: "create", ref, path, version: skill.version, target: target.dir });
        continue;
      }
      // Something is on disk that sync never wrote — never clobber it.
      if (!owned) {
        actions.push({ kind: "conflict", ref, path, reason: "unmanaged" });
        continue;
      }

      const drifted = actual.dirHash !== owned.dirHash;
      const sameVersion = owned.version === skill.version;
      const sameSkill = owned.org === skill.org && owned.repo === skill.repo;

      if (!sameVersion || !sameSkill) {
        if (drifted && !input.force) {
          actions.push({ kind: "conflict", ref, path, reason: "local-edit" });
          continue;
        }
        actions.push({
          kind: "update",
          ref,
          path,
          from: owned.version,
          to: skill.version,
          target: target.dir,
        });
        continue;
      }

      if (drifted) {
        if (!input.force) {
          actions.push({ kind: "conflict", ref, path, reason: "local-edit" });
          continue;
        }
        actions.push({ kind: "restore", ref, path, version: skill.version, target: target.dir });
      }
    }
  }

  // Prune only ever touches manifest-owned paths, and only when asked. It is
  // further scoped to the targets of *this* run: a narrowed `--target` or a
  // `--scope user` pass must not delete materializations it was not asked to
  // reconcile.
  if (input.prune) {
    const inScope = new Set(input.targets.map((t) => t.dir));
    for (const entry of input.manifest.entries) {
      if (!inScope.has(entry.target)) continue;
      if (!desiredPaths.has(entry.path)) actions.push({ kind: "prune", path: entry.path });
    }
  }

  for (const entry of input.actual) {
    if (desiredPaths.has(entry.path) || manifestByPath.has(entry.path)) continue;
    actions.push({ kind: "untracked", path: entry.path });
  }

  for (const skill of input.desired) {
    if (skill.latest && compareSemver(skill.latest, skill.version) > 0) {
      actions.push({
        kind: "stale",
        ref: `${skill.org}/${skill.repo}`,
        have: skill.version,
        latest: skill.latest,
      });
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type SyncDeps = {
  fetchMeta: (
    org: string,
    repo: string,
  ) => Promise<{ version: string; contentSha256?: string } | null>;
  fetchBundle: (
    org: string,
    repo: string,
    version: string,
  ) => Promise<{ files: Record<string, string>; version: string }>;
  enforcePolicy: (ref: string) => Promise<void>;
  recordActivation: (
    org: string,
    repo: string,
    harness: SourceType,
    scope: SyncScope,
  ) => Promise<void>;
};

function parseSkillRef(ref: string): { org: string; repo: string } {
  const [org, repo] = ref.split("/");
  if (!org || !repo || repo.includes("@")) {
    throw new Error(
      `Invalid skill ref "${ref}" in ${CONFIG_FILE} — use org/repo with a separate "version"`,
    );
  }
  return { org, repo };
}

/**
 * Turns config (or, with no config, the lockfile) into exact pinned versions.
 * Collisions fail loudly: auto-renaming would desynchronize the directory name
 * from the SKILL.md frontmatter, and rewriting the frontmatter would invalidate
 * the published sha256.
 */
export async function resolveDesired(
  config: SyncConfig,
  lock: Lockfile,
  deps: SyncDeps,
): Promise<ResolvedSkill[]> {
  const fromConfig = config.skills.length > 0;
  const entries = fromConfig
    ? config.skills.map((s) => ({ ...parseSkillRef(s.ref), range: s.version, as: s.as }))
    : lock.skills.map((s) => ({ org: s.org, repo: s.repo, range: s.version, as: undefined }));

  const resolved: ResolvedSkill[] = [];
  for (const entry of entries) {
    const meta = await deps.fetchMeta(entry.org, entry.repo);
    const range = entry.range;
    let version: string;

    if (range && EXACT.test(range)) {
      version = range;
    } else {
      if (!meta?.version) {
        throw new Error(
          `Cannot resolve ${entry.org}/${entry.repo}${range ? `@${range}` : ""} — skill not found in the registry`,
        );
      }
      if (range && !satisfiesRange(meta.version, range)) {
        throw new Error(
          `No published version of ${entry.org}/${entry.repo} satisfies "${range}" (latest is ${meta.version}) — pin an exact version`,
        );
      }
      version = meta.version;
    }

    resolved.push({
      org: entry.org,
      repo: entry.repo,
      name: entry.as ?? entry.repo,
      version,
      ...(meta?.version ? { latest: meta.version } : {}),
      ...(meta?.contentSha256 && meta.version === version
        ? { contentSha256: meta.contentSha256 }
        : {}),
    });
  }

  assertNoCollisions(resolved);
  return resolved;
}

export function assertNoCollisions(skills: ResolvedSkill[]) {
  const byName = new Map<string, ResolvedSkill>();
  for (const skill of skills) {
    const clash = byName.get(skill.name);
    if (clash) {
      throw new Error(
        `Name collision — ${clash.org}/${clash.repo} and ${skill.org}/${skill.repo} both materialize as "${skill.name}". Add "as" to one in ${CONFIG_FILE}.`,
      );
    }
    byName.set(skill.name, skill);
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

async function writeBundleToStore(
  cwd: string,
  org: string,
  repo: string,
  version: string,
  files: Record<string, string>,
) {
  const dir = join(cwd, storePath(org, repo, version));
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(dir, path);
    await mkdir(dirname(filePath), { recursive: true });
    if (isBinaryAssetPath(path)) {
      await writeFile(filePath, Buffer.from(content, "base64"));
    } else {
      await writeFile(filePath, content, "utf8");
    }
  }
}

async function copyDir(src: string, dest: string) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await writeFile(to, await readFile(from));
    }
  }
}

async function materialize(
  cwd: string,
  skill: ResolvedSkill,
  targetAbs: string,
  linkMode: LinkMode,
): Promise<void> {
  const src = join(cwd, storePath(skill.org, skill.repo, skill.version));
  const dest = join(targetAbs, skill.name);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });

  if (linkMode === "symlink") {
    try {
      await symlink(relative(dirname(dest), src), dest, "dir");
      return;
    } catch {
      // Windows without developer mode, or a filesystem that forbids links.
      console.error(`Symlink failed for ${skill.name} — falling back to copy`);
    }
  }
  await copyDir(src, dest);
}

export type ApplyResult = {
  applied: SyncAction[];
  skipped: SyncAction[];
  manifest: Manifest;
};

export async function applySync(
  actions: SyncAction[],
  context: {
    cwd: string;
    desired: ResolvedSkill[];
    targets: SyncTarget[];
    manifest: Manifest;
    lock: Lockfile;
    config: SyncConfig;
    scope: SyncScope;
    linkMode: LinkMode;
    prune: boolean;
  },
  deps: SyncDeps,
): Promise<ApplyResult> {
  const { cwd, desired, targets, manifest, lock } = context;
  const bySkillName = new Map(desired.map((s) => [s.name, s]));
  const byTargetDir = new Map(targets.map((t) => [t.dir, t]));
  const applied: SyncAction[] = [];
  const skipped: SyncAction[] = [];
  const entries = new Map(manifest.entries.map((e) => [e.path, e]));

  // 1. Populate the store. Policy is enforced before anything touches disk, so
  //    a blocked skill can never land half-applied across targets.
  for (const action of actions) {
    if (action.kind !== "fetch") continue;
    await deps.enforcePolicy(action.ref);
  }
  for (const action of actions) {
    if (action.kind !== "fetch") continue;
    const { org, repo } = parseSkillRef(action.ref);
    const bundle = await deps.fetchBundle(org, repo, action.version);
    await writeBundleToStore(cwd, org, repo, action.version, bundle.files);
    applied.push(action);
  }

  // 2. Materialize into every target.
  for (const action of actions) {
    if (action.kind !== "create" && action.kind !== "update" && action.kind !== "restore") continue;
    const name = action.path.slice(action.path.lastIndexOf("/") + 1);
    const skill = bySkillName.get(name);
    const target = byTargetDir.get(action.target);
    if (!skill || !target) {
      skipped.push(action);
      continue;
    }

    await materialize(cwd, skill, target.abs, context.linkMode);
    const abs = join(target.abs, skill.name);
    entries.set(action.path, {
      path: action.path,
      org: skill.org,
      repo: skill.repo,
      version: skill.version,
      dirHash: await hashSkillDir(abs),
      target: target.dir,
      harness: target.harness,
      writtenAt: new Date().toISOString(),
    });
    applied.push(action);
    await deps.recordActivation(skill.org, skill.repo, target.harness, context.scope);
  }

  // 3. Prune — manifest-owned paths only, already filtered by the planner.
  for (const action of actions) {
    if (action.kind !== "prune") continue;
    const owned = entries.get(action.path);
    if (!owned) {
      skipped.push(action);
      continue;
    }
    const base = context.scope === "user" ? "/" : cwd;
    await rm(resolve(base, action.path), { recursive: true, force: true });
    entries.delete(action.path);
    applied.push(action);
  }

  // 4. Record resolved versions back into the lockfile.
  for (const skill of desired) {
    const existing = lock.skills.find((s) => s.org === skill.org && s.repo === skill.repo);
    const entry: LockEntry = {
      org: skill.org,
      repo: skill.repo,
      version: skill.version,
      installedAt:
        existing?.version === skill.version ? existing.installedAt : new Date().toISOString(),
      path: existing?.path ?? storePath(skill.org, skill.repo, skill.version),
      ...(skill.contentSha256 ? { contentSha256: skill.contentSha256 } : {}),
    };
    upsertLockEntry(lock, entry);
  }

  const nextManifest: Manifest = { version: 1, entries: [...entries.values()] };
  return { applied, skipped, manifest: nextManifest };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function formatPlan(actions: SyncAction[], options: { prune: boolean }): string[] {
  const lines: string[] = [];
  for (const action of actions) {
    switch (action.kind) {
      case "fetch":
        lines.push(`${action.ref}  v${action.version}  fetch`);
        break;
      case "create":
        lines.push(`${action.ref}  v${action.version}  created    ${action.path}`);
        break;
      case "update":
        lines.push(`${action.ref}  v${action.from} → v${action.to}  updated    ${action.path}`);
        break;
      case "restore":
        lines.push(`${action.ref}  v${action.version}  restored   ${action.path}`);
        break;
      case "prune":
        lines.push(`pruned     ${action.path}`);
        break;
      case "conflict":
        lines.push(
          action.reason === "local-edit"
            ? `${action.ref}  MODIFIED   ${action.path} (local edits; --force to restore)`
            : `${action.ref}  UNMANAGED  ${action.path} (not written by sync; move it aside first)`,
        );
        break;
      case "untracked":
        lines.push(`untracked  ${action.path}`);
        break;
      case "stale":
        lines.push(
          `${action.ref}  v${action.have} — v${action.latest} available (skillist update)`,
        );
        break;
    }
  }
  if (!options.prune && lines.length === 0) lines.push("Everything is in sync");
  return lines;
}

export function summarize(actions: SyncAction[], targets: number): string {
  const count = (kind: SyncAction["kind"]) => actions.filter((a) => a.kind === kind).length;
  const changed = count("create") + count("update") + count("restore");
  const parts = [
    `${changed} materialized`,
    `${targets} target${targets === 1 ? "" : "s"}`,
    `${count("conflict")} conflict${count("conflict") === 1 ? "" : "s"}`,
    `${count("untracked")} untracked`,
  ];
  if (count("prune") > 0) parts.push(`${count("prune")} pruned`);
  if (count("stale") > 0) parts.push(`${count("stale")} stale`);
  return parts.join(" · ");
}
