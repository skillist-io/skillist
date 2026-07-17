import type { DiscoveredSkill, GithubTreeEntry } from "./fetch";

const DEFAULT_ROOTS = ["skills", ".cursor/skills", ".claude/skills", ".vscode/skills"];

export function discoverSkillsFromTree(
  tree: GithubTreeEntry[],
  discoveryRoots: string[] = DEFAULT_ROOTS,
): DiscoveredSkill[] {
  const skillMdPaths = tree
    .filter((e) => e.type === "blob" && e.path.endsWith("/SKILL.md"))
    .map((e) => e.path);

  const discovered: DiscoveredSkill[] = [];
  const seen = new Set<string>();

  for (const skillMdPath of skillMdPaths) {
    const sourcePath = skillMdPath.slice(0, -"/SKILL.md".length);
    const root = discoveryRoots.find((r) => sourcePath === r || sourcePath.startsWith(`${r}/`));
    if (!root) continue;

    // Only accept one level under the root: skills/{slug}/SKILL.md
    const relative = sourcePath.slice(root.length).replace(/^\//, "");
    if (!relative || relative.includes("/")) continue;

    const skillSlug = relative;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillSlug)) continue;
    if (seen.has(skillSlug)) continue;
    seen.add(skillSlug);

    discovered.push({
      skillSlug,
      sourcePath,
      skillMdPath,
    });
  }

  return discovered.sort((a, b) => a.skillSlug.localeCompare(b.skillSlug));
}

/** Collect blob paths under a skill folder (relative to sourcePath). */
export function listSkillFileEntries(
  tree: GithubTreeEntry[],
  sourcePath: string,
): { relativePath: string; sha: string }[] {
  const prefix = `${sourcePath}/`;
  return tree
    .filter((e) => e.type === "blob" && e.path.startsWith(prefix))
    .map((e) => ({
      relativePath: e.path.slice(prefix.length),
      sha: e.sha,
    }))
    .filter((e) => e.relativePath && !e.relativePath.startsWith("."));
}
