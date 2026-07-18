const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export type SkillRef = {
  org: string;
  repo: string;
  /** Exact pinned version, when the ref was org/repo@x.y.z. */
  version?: string;
};

/**
 * Parses `org/repo`, `org/repo@latest`, or `org/repo@1.2.3`.
 * Mirrors the delivery path's specifier grammar (apps/api parseRepoSpecifier).
 */
export function parseRef(ref: string): SkillRef {
  const [org, repoSpec] = ref.split("/");
  if (!org || !repoSpec) {
    throw new Error(`Invalid ref "${ref}" — use org/repo or org/repo@version`);
  }
  const at = repoSpec.indexOf("@");
  if (at === -1) return { org, repo: repoSpec };
  const repo = repoSpec.slice(0, at);
  const specifier = repoSpec.slice(at + 1);
  if (!repo) throw new Error(`Invalid ref "${ref}" — use org/repo or org/repo@version`);
  if (specifier === "latest") return { org, repo };
  if (!EXACT_SEMVER.test(specifier)) {
    throw new Error(`Invalid version "${specifier}" in "${ref}" — use an exact version or latest`);
  }
  return { org, repo, version: specifier };
}

/** Delivery path segment for a ref: `org/repo` or `org/repo@1.2.3`. */
export function deliveryRef(ref: SkillRef): string {
  return ref.version ? `${ref.org}/${ref.repo}@${ref.version}` : `${ref.org}/${ref.repo}`;
}
