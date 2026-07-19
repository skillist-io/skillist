import type { ProjectItem } from "@skillist/ui";
import { buildPathTree, type TreeNode } from "@/components/skill-editor/paths";

/** Human label for a curated item's leaf: explicit label, else repo/external name. */
export function projectItemLeafName(item: ProjectItem): string {
  if (item.label) return item.label;
  if (item.kind === "skill") return item.repo;
  return item.externalName ?? "item";
}

/** The item's full position in the folder tree: `path/leaf`, or just `leaf` at root. */
export function projectItemDisplayPath(item: ProjectItem): string {
  const leaf = projectItemLeafName(item);
  return item.path ? `${item.path}/${leaf}` : leaf;
}

/**
 * Distinct folder paths present in a project, including every parent prefix, so
 * a `backend/db` item contributes both `backend` and `backend/db`. Sorted for
 * stable rendering; used to seed folder autocomplete (see `FolderInput`).
 */
export function projectFolderPaths(items: ProjectItem[]): string[] {
  const paths = new Set<string>();
  for (const item of items) {
    const trimmed = item.path?.trim();
    if (!trimmed) continue;
    const segments = trimmed.split("/").filter(Boolean);
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      paths.add(prefix);
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

export type ProjectTree = {
  nodes: TreeNode[];
  /** Maps a leaf node's `path` back to the curated item it represents. */
  itemByPath: Map<string, ProjectItem>;
};

/**
 * Turns a project's flat item list into a folder tree. Each item becomes a
 * leaf under its `path` folder; the returned map lets leaf nodes resolve back
 * to their item for linking/actions. Colliding display paths are disambiguated
 * so every leaf maps to exactly one item.
 */
export function buildProjectTree(items: ProjectItem[]): ProjectTree {
  const itemByPath = new Map<string, ProjectItem>();
  for (const item of items) {
    let path = projectItemDisplayPath(item);
    if (itemByPath.has(path)) {
      let n = 2;
      while (itemByPath.has(`${path} (${n})`)) n++;
      path = `${path} (${n})`;
    }
    itemByPath.set(path, item);
  }
  const nodes = buildPathTree([...itemByPath.keys()]);
  return { nodes, itemByPath };
}
