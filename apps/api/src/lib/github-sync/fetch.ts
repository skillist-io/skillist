/** Compatible SPDX-ish license identifiers for official mirrors. */
export const COMPATIBLE_LICENSES = new Set([
  "mit",
  "apache-2.0",
  "bsd-2-clause",
  "bsd-3-clause",
  "isc",
  "0bsd",
  "cc0-1.0",
  "unlicense",
  "mpl-2.0",
]);

export type GithubRepoMeta = {
  fullName: string;
  defaultBranch: string;
  license: string | null;
  homepageUrl: string | null;
  stars: number;
  htmlUrl: string;
};

export type GithubTreeEntry = {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
};

export type DiscoveredSkill = {
  skillSlug: string;
  sourcePath: string;
  skillMdPath: string;
};

function githubHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "skillist-mirror-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubJson<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchRepoMetadata(
  owner: string,
  repo: string,
  token?: string,
): Promise<GithubRepoMeta> {
  const data = await githubJson<{
    full_name: string;
    default_branch: string;
    license?: { spdx_id?: string | null } | null;
    homepage?: string | null;
    stargazers_count?: number;
    html_url: string;
  }>(`https://api.github.com/repos/${owner}/${repo}`, token);

  return {
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    license:
      data.license?.spdx_id && data.license.spdx_id !== "NOASSERTION" ? data.license.spdx_id : null,
    homepageUrl: data.homepage || data.html_url,
    stars: data.stargazers_count ?? 0,
    htmlUrl: data.html_url,
  };
}

export async function fetchCommitSha(
  owner: string,
  repo: string,
  ref: string,
  token?: string,
): Promise<string> {
  const data = await githubJson<{ sha: string }>(
    `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
    token,
  );
  return data.sha;
}

export async function fetchRepoTree(
  owner: string,
  repo: string,
  commitSha: string,
  token?: string,
): Promise<GithubTreeEntry[]> {
  const data = await githubJson<{
    tree: { path: string; type: string; sha: string; size?: number }[];
    truncated: boolean;
  }>(`https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`, token);
  if (data.truncated) {
    throw new Error(`GitHub tree for ${owner}/${repo}@${commitSha} is truncated`);
  }
  return data.tree
    .filter((e) => e.type === "blob" || e.type === "tree")
    .map((e) => ({
      path: e.path,
      type: e.type as "blob" | "tree",
      sha: e.sha,
      size: e.size,
    }));
}

export async function fetchBlobText(
  owner: string,
  repo: string,
  fileSha: string,
  token?: string,
): Promise<string> {
  const data = await githubJson<{ content: string; encoding: string }>(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs/${fileSha}`,
    token,
  );
  if (data.encoding === "base64") {
    const binary = atob(data.content.replace(/\n/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return data.content;
}

/** Stream GitHub tarball into R2. Returns false if already cached. */
export async function cacheTarballToR2(
  bucket: R2Bucket,
  owner: string,
  repo: string,
  commitSha: string,
  token?: string,
): Promise<{ key: string; cached: boolean }> {
  const key = `mirror-cache/${owner}/${repo}/${commitSha}.tar.gz`;
  const existing = await bucket.head(key);
  if (existing) return { key, cached: true };

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/tarball/${commitSha}`, {
    headers: githubHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`Failed to download tarball ${owner}/${repo}@${commitSha}: ${res.status}`);
  }

  // R2 requires a known-length body; GitHub tarball streams omit Content-Length.
  const bytes = await res.arrayBuffer();
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: "application/gzip" },
    customMetadata: { owner, repo, commitSha },
  });
  return { key, cached: false };
}

export function isCompatibleLicense(license: string | null | undefined): boolean {
  if (!license) return false;
  return COMPATIBLE_LICENSES.has(license.toLowerCase());
}

/**
 * Curated allowlist sources may omit GitHub SPDX metadata (e.g. anthropics/skills).
 * Still reject clearly incompatible SPDX when present.
 */
export function assertMirrorLicenseAllowed(
  license: string | null | undefined,
  trustTier: string,
): void {
  if (!license) {
    if (trustTier === "official_mirror") return;
    throw new Error("Missing license");
  }
  if (!isCompatibleLicense(license)) {
    throw new Error(`Incompatible license: ${license}`);
  }
}
