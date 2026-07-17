import type { SkillBundle } from "@skillist/skill-format";
import { sha256 } from "../r2";
import { listSkillFileEntries } from "./discover";
import { fetchBlobText, type GithubTreeEntry } from "./fetch";

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

export async function hashSkillBundle(bundle: SkillBundle): Promise<string> {
  const parts = [...bundle.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => `${path}\0${content}`);
  return sha256(parts.join("\n"));
}
