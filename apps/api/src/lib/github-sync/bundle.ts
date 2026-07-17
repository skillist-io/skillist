import type { SkillBundle } from "@skillist/skill-format";
import { sha256 } from "../r2";
import { listSkillFileEntries } from "./discover";
import { fetchBlobText, type GithubTreeEntry } from "./fetch";
import { loadSkillBundleFromTarball } from "./tarball";

export async function hashSkillTreeSnapshot(
  tree: GithubTreeEntry[],
  sourcePath: string,
): Promise<string> {
  const parts = listSkillFileEntries(tree, sourcePath)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map(({ relativePath, sha }) => `${relativePath}\0${sha}`);
  return sha256(parts.join("\n"));
}

export async function loadSkillBundleFromTree(
  owner: string,
  repo: string,
  tree: GithubTreeEntry[],
  sourcePath: string,
  token?: string,
): Promise<SkillBundle> {
  const entries = listSkillFileEntries(tree, sourcePath);
  const bundle: SkillBundle = new Map();

  // Cap files per skill to stay within Worker limits
  const limited = entries.slice(0, 200);
  await Promise.all(
    limited.map(async ({ relativePath, sha }) => {
      const content = await fetchBlobText(owner, repo, sha, token);
      bundle.set(relativePath, content);
    }),
  );

  return bundle;
}

/** Prefer R2 tarball (one download); fall back to per-blob GitHub tree fetches. */
export async function loadMirrorSkillBundle(
  bucket: R2Bucket,
  owner: string,
  repo: string,
  commitSha: string,
  sourcePath: string,
  tree: GithubTreeEntry[],
  token?: string,
): Promise<SkillBundle> {
  const fromTarball = await loadSkillBundleFromTarball(bucket, owner, repo, commitSha, sourcePath);
  if (fromTarball) return fromTarball;
  return loadSkillBundleFromTree(owner, repo, tree, sourcePath, token);
}

export async function hashSkillBundle(bundle: SkillBundle): Promise<string> {
  const parts = [...bundle.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => `${path}\0${content}`);
  return sha256(parts.join("\n"));
}

const MIRROR_OPTIONAL_DIRS = ["scripts", "references", "assets"] as const;
const MIRROR_ROOT_FILES = new Set(["SKILL.md", "plugin.json"]);

/**
 * Official vendor skills often include extra files (examples/, tests/, LICENSE).
 * Keep agentskills.io-valid paths only so validateSkillBundle can pass.
 */
export function sanitizeMirrorBundle(bundle: SkillBundle): SkillBundle {
  const out: SkillBundle = new Map();
  for (const [path, content] of bundle) {
    if (MIRROR_ROOT_FILES.has(path)) {
      out.set(path, content);
      continue;
    }
    const top = path.split("/")[0];
    if (top && (MIRROR_OPTIONAL_DIRS as readonly string[]).includes(top)) {
      out.set(path, content);
    }
  }

  const skillMd = out.get("SKILL.md");
  if (skillMd) {
    out.set("SKILL.md", truncateFrontmatterDescription(skillMd, 1024));
  }
  return out;
}

/** Clamp YAML description to agentskills.io max length without full re-parse. */
export function truncateFrontmatterDescription(skillMd: string, maxLen: number): string {
  const match = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)$/);
  if (!match) return skillMd;
  const fm = match[1]!;
  const body = match[2]!;
  const descMatch = fm.match(/^description:\s*(.*)$/m);
  if (!descMatch) return skillMd;
  let value = descMatch[1] ?? "";
  // quoted block
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const q = value[0]!;
    const inner = value.slice(1, -1);
    if (inner.length <= maxLen) return skillMd;
    value = `${q}${inner.slice(0, maxLen - 1)}…${q}`;
  } else if (value.length > maxLen) {
    value = `${value.slice(0, maxLen - 1)}…`;
  } else {
    return skillMd;
  }
  const newFm = fm.replace(/^description:\s*.*$/m, `description: ${value}`);
  return `---\n${newFm}\n---${body}`;
}
