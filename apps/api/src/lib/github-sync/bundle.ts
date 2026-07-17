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
