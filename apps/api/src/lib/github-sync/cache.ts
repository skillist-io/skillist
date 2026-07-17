import type { GithubTreeEntry } from "./fetch";

const TREE_TTL_SECONDS = 60 * 60; // 1 hour

export function treeCacheKey(owner: string, repo: string, commitSha: string): string {
  return `github:tree:${owner}:${repo}:${commitSha}`;
}

export async function getCachedTree(
  kv: KVNamespace,
  owner: string,
  repo: string,
  commitSha: string,
): Promise<GithubTreeEntry[] | null> {
  const raw = await kv.get(treeCacheKey(owner, repo, commitSha));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GithubTreeEntry[];
  } catch {
    return null;
  }
}

export async function putCachedTree(
  kv: KVNamespace,
  owner: string,
  repo: string,
  commitSha: string,
  tree: GithubTreeEntry[],
): Promise<void> {
  await kv.put(treeCacheKey(owner, repo, commitSha), JSON.stringify(tree), {
    expirationTtl: TREE_TTL_SECONDS,
  });
}

export function tarballCacheKey(owner: string, repo: string, commitSha: string): string {
  return `mirror-cache/${owner}/${repo}/${commitSha}.tar.gz`;
}
