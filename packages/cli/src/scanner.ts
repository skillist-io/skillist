import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { access, lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { validateSkillBundle } from "@skillist/skill-format";
import {
  inferMarketplace,
  inferScope,
  inferType,
  type SkillScope,
  type SourceType,
} from "./source.js";

const HARD_IGNORE = new Set(["node_modules", ".git", "dist", ".next", ".turbo", ".cache"]);

export const DEFAULT_PROJECT_ROOTS = [
  ".cursor/skills",
  ".claude/skills",
  ".claude/plugins/marketplaces",
  ".agents/skills",
  ".gemini/skills",
  ".codex/skills",
  ".vscode/skills",
  "skills",
] as const;

export type DiscoveredSkill = {
  dir: string;
  filePath: string;
  localSlug: string;
  sourceType: SourceType;
  scope: SkillScope;
  marketplace?: string;
  pluginName?: string;
  isSymlink: boolean;
  contentHash: string;
  skillMd: string;
  conformanceStatus: "valid" | "invalid";
  conformanceIssues: { level: string; field?: string; message: string }[];
};

export type ScanOptions = {
  maxDepth?: number;
  followSymlinks?: boolean;
  signal?: AbortSignal;
  ignore?: string[];
};

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function matchIgnore(rel: string, ignore: string[]): boolean {
  for (const glob of ignore) {
    // Minimal glob: **/foo and prefix*
    if (glob.startsWith("**/") && rel.includes(glob.slice(3).replace(/\/$/, ""))) return true;
    if (glob.endsWith("/**") && rel.startsWith(glob.slice(0, -3))) return true;
    if (rel === glob || rel.includes(`/${glob}/`) || rel.startsWith(`${glob}/`)) return true;
  }
  return false;
}

async function* walkSkills(
  root: string,
  opts: ScanOptions,
  visited: Set<string>,
): AsyncGenerator<DiscoveredSkill> {
  const maxDepth = opts.maxDepth ?? 6;
  const followSymlinks = opts.followSymlinks ?? true;
  const ignore = opts.ignore ?? [];

  let rootStat: Stats;
  try {
    rootStat = await stat(root);
  } catch {
    return;
  }
  if (!rootStat.isDirectory()) return;

  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    if (opts.signal?.aborted) return;
    const item = queue.shift();
    if (!item) break;
    const { dir, depth } = item;

    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const hasSkill = entries.some(
      (e) => e.name === "SKILL.md" && (e.isFile() || e.isSymbolicLink()),
    );
    if (hasSkill) {
      const record = await buildRecord(dir, followSymlinks, visited);
      if (record) yield record;
      continue;
    }

    if (depth >= maxDepth) continue;

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (HARD_IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;
      const child = join(dir, entry.name);
      const rel = toPosix(relative(root, child));
      if (matchIgnore(rel, ignore)) continue;
      queue.push({ dir: child, depth: depth + 1 });
    }
  }
}

async function buildRecord(
  dir: string,
  followSymlinks: boolean,
  visited: Set<string>,
): Promise<DiscoveredSkill | null> {
  const skillFile = join(dir, "SKILL.md");
  try {
    await access(skillFile);
  } catch {
    return null;
  }

  let resolved = dir;
  let isSymlink = false;
  try {
    const ls = await lstat(dir);
    if (ls.isSymbolicLink()) isSymlink = true;
    if (followSymlinks) resolved = await realpath(dir);
  } catch {
    // keep original
  }

  if (visited.has(resolved)) return null;
  visited.add(resolved);

  const skillMd = await readFile(skillFile, "utf8");
  const contentHash = createHash("sha256").update(skillMd).digest("hex").slice(0, 16);
  const bundle = new Map([["SKILL.md", skillMd]]);
  const localSlug = basename(dir);
  const validation = validateSkillBundle(bundle, localSlug);

  const type = inferType(resolved);
  const scope = inferScope(resolved);
  const { marketplace, pluginName } = inferMarketplace(resolved);

  return {
    dir,
    filePath: toPosix(relative(process.cwd(), skillFile)),
    localSlug,
    sourceType: type,
    scope,
    ...(marketplace ? { marketplace } : {}),
    ...(pluginName ? { pluginName } : {}),
    isSymlink,
    contentHash,
    skillMd,
    conformanceStatus: validation.valid ? "valid" : "invalid",
    conformanceIssues: validation.valid
      ? []
      : validation.errors.map((e) => ({
          level: "error",
          field: e.path,
          message: e.message,
        })),
  };
}

export async function scanSkillRoots(
  roots: string[],
  opts: ScanOptions = {},
): Promise<DiscoveredSkill[]> {
  const visited = new Set<string>();
  const out: DiscoveredSkill[] = [];
  for (const root of roots) {
    for await (const skill of walkSkills(root, opts, visited)) {
      out.push(skill);
    }
  }
  return out;
}

export async function scanProjectSkills(
  cwd: string,
  opts: ScanOptions = {},
): Promise<DiscoveredSkill[]> {
  const roots = DEFAULT_PROJECT_ROOTS.map((r) => join(cwd, r));
  const skills = await scanSkillRoots(roots, opts);
  // Recompute filePath relative to cwd
  return skills.map((s) => ({
    ...s,
    filePath: toPosix(relative(cwd, join(s.dir, "SKILL.md"))),
  }));
}
