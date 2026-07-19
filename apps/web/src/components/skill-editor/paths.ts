import {
  BINARY_ASSET_EXTENSIONS,
  isBinaryAssetPath,
  MAX_BINARY_ASSET_BYTES,
} from "@skillist/skill-format";

export { BINARY_ASSET_EXTENSIONS, isBinaryAssetPath, MAX_BINARY_ASSET_BYTES };

const BUNDLE_DIRS = ["scripts", "references", "assets"] as const;
const ROOT_FILES = ["SKILL.md", "plugin.json"] as const;
const SEGMENT_REGEX = /^[A-Za-z0-9._-]+$/;
const TEXT_EXTENSIONS = [
  ".md",
  ".txt",
  ".py",
  ".sh",
  ".js",
  ".ts",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
] as const;

export type BundleDir = (typeof BUNDLE_DIRS)[number];

export const bundleDirs: readonly BundleDir[] = BUNDLE_DIRS;

export function isAllowedPath(path: string): boolean {
  if ((ROOT_FILES as readonly string[]).includes(path)) return true;
  const segments = path.split("/");
  if (segments.length < 2) return false;
  if (!BUNDLE_DIRS.includes(segments[0] as BundleDir)) return false;
  return segments.every((segment) => SEGMENT_REGEX.test(segment) && segment !== "..");
}

export function isProtectedPath(path: string): boolean {
  return path === "SKILL.md";
}

export function isTextPath(path: string): boolean {
  const lower = path.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Maps an arbitrary uploaded filename into a valid bundle path segment. */
export function sanitizeAssetFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

export function isDirPath(files: Record<string, string>, path: string): boolean {
  const prefix = `${path}/`;
  return Object.keys(files).some((key) => key.startsWith(prefix));
}

/** Paths under a directory prefix, e.g. everything removed by a folder delete. */
export function pathsUnder(files: Record<string, string>, dir: string): string[] {
  const prefix = `${dir}/`;
  return Object.keys(files).filter((key) => key.startsWith(prefix));
}

export type TreeNode = {
  name: string;
  path: string;
  children?: TreeNode[];
};

/**
 * Builds a nested folder tree from a flat list of slash-delimited paths.
 * Leaves are files (no `children`); intermediate segments become dir nodes.
 * Generic and content-agnostic — pass a comparator for custom ordering, or
 * rely on the default alphabetical sort. `pendingDirs` materializes empty
 * folders that have no files under them yet.
 */
export function buildPathTree(
  paths: string[],
  options: {
    pendingDirs?: string[];
    compare?: (a: TreeNode, b: TreeNode) => number;
  } = {},
): TreeNode[] {
  const { pendingDirs = [], compare } = options;
  const roots: TreeNode[] = [];
  const dirNodes = new Map<string, TreeNode>();

  const ensureDir = (dirPath: string): TreeNode => {
    const existing = dirNodes.get(dirPath);
    if (existing) return existing;
    const segments = dirPath.split("/");
    const node: TreeNode = {
      name: segments[segments.length - 1] ?? dirPath,
      path: dirPath,
      children: [],
    };
    dirNodes.set(dirPath, node);
    if (segments.length === 1) {
      roots.push(node);
    } else {
      ensureDir(segments.slice(0, -1).join("/")).children?.push(node);
    }
    return node;
  };

  const sortedPaths = [...paths].sort();
  for (const path of sortedPaths) {
    const segments = path.split("/");
    if (segments.length === 1) {
      roots.push({ name: path, path });
    } else {
      ensureDir(segments.slice(0, -1).join("/")).children?.push({
        name: segments[segments.length - 1] ?? path,
        path,
      });
    }
  }
  for (const dir of pendingDirs) {
    if (!dirNodes.has(dir) && !sortedPaths.some((p) => p.startsWith(`${dir}/`))) {
      ensureDir(dir);
    }
  }

  const cmp = compare ?? ((a, b) => a.name.localeCompare(b.name));
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort(cmp);
    for (const node of nodes) {
      if (node.children) sortNodes(node.children);
    }
  };
  sortNodes(roots);
  return roots;
}

/** Builds the display tree: root files first (SKILL.md pinned on top), then spec dirs. */
export function buildTree(files: Record<string, string>, pendingDirs: string[] = []): TreeNode[] {
  const rank = (node: TreeNode) => {
    if (node.path === "SKILL.md") return 0;
    if (!node.children) return 1;
    return 2;
  };
  return buildPathTree(Object.keys(files), {
    pendingDirs,
    compare: (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  });
}
