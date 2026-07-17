import type { DiscoveredSkill, GithubTreeEntry } from "./fetch";

const DEFAULT_ROOTS = ["skills", ".cursor/skills", ".claude/skills", ".vscode/skills"];

/**
 * Find directories containing SKILL.md under configured roots.
 * Supports flat (`skills/{slug}/SKILL.md`) and nested plugin layouts
 * (`plugins/{plugin}/skills/{slug}/SKILL.md`).
 */
export function discoverSkillsFromTree(
  tree: GithubTreeEntry[],
  discoveryRoots: string[] = DEFAULT_ROOTS,
): DiscoveredSkill[] {
  const skillMdPaths = tree
    .filter((e) => e.type === "blob" && e.path.endsWith("/SKILL.md"))
    .map((e) => e.path);

  const discovered: DiscoveredSkill[] = [];
  const seenSlugs = new Set<string>();

  for (const skillMdPath of skillMdPaths) {
    const sourcePath = skillMdPath.slice(0, -"/SKILL.md".length);
    const root = discoveryRoots.find((r) => sourcePath === r || sourcePath.startsWith(`${r}/`));
    if (!root) {
      // Also match nested .../skills/{slug} even when root is just "skills"
      // by allowing any path segment named in discoveryRoots as an ancestor.
      const matched = discoveryRoots.some((r) => {
        const marker = `/${r}/`;
        return sourcePath.includes(marker) || sourcePath.startsWith(`${r}/`);
      });
      if (!matched) continue;
    }

    const skillSlug = sourcePath.split("/").pop();
    if (!skillSlug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillSlug)) continue;
    if (seenSlugs.has(skillSlug)) continue;
    seenSlugs.add(skillSlug);

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
