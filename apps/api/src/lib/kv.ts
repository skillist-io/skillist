export function skillMetaKey(orgSlug: string, skillRepo: string) {
  return `skill:${orgSlug}:${skillRepo}:meta`;
}

export function skillMdKey(orgSlug: string, skillRepo: string) {
  return `skill:${orgSlug}:${skillRepo}:latest`;
}

export function skillVersionKey(orgSlug: string, skillRepo: string, version: string) {
  return `skill:${orgSlug}:${skillRepo}:v:${version}`;
}

export type SkillKvMeta = {
  name: string;
  description: string;
  version: string;
  versionId: string;
  etag: string;
  org: string;
  repo: string;
  publishedAt: string;
  /**
   * Visibility at publish time. The public delivery handlers serve only
   * "public" and fail closed on anything else (including a missing value from
   * a pre-visibility cache entry), so a private/org skill can never be read
   * back off the public edge path.
   */
  visibility?: "private" | "org" | "public";
  /** Origin type for badges/filters: native or mirror. */
  sourceType?: "native" | "mirror";
  upstreamRepo?: string;
  upstreamUrl?: string;
};

export type SkillKvContent = {
  skillMd: string;
  meta: SkillKvMeta;
};
