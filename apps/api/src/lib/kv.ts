export function skillMetaKey(orgSlug: string, skillRepo: string) {
  return `skill:${orgSlug}:${skillRepo}:meta`;
}

export function skillMdKey(orgSlug: string, skillRepo: string) {
  return `skill:${orgSlug}:${skillRepo}:latest`;
}

export function skillVersionKey(orgSlug: string, skillRepo: string, version: string) {
  return `skill:${orgSlug}:${skillRepo}:v:${version}`;
}

export function skillVersionMetaKey(orgSlug: string, skillRepo: string, version: string) {
  return `skill:${orgSlug}:${skillRepo}:v:${version}:meta`;
}

/** Prefix covering every per-version key of a skill (SKILL.md and meta). */
export function skillVersionPrefix(orgSlug: string, skillRepo: string) {
  return `skill:${orgSlug}:${skillRepo}:v:`;
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
  /** Full (untruncated) sha256 of SKILL.md, for client-side integrity checks. */
  contentSha256?: string;
  /**
   * R2 key of the materialized bundle JSON for this version. Internal storage
   * pointer (contains the org uuid) — the /meta response strips it.
   */
  bundleKey?: string;
};

/**
 * KV per-key metadata stored alongside the SKILL.md value, so the delivery
 * path can serve SKILL.md (headers included) from a single KV read instead of
 * a second read of the meta key. Must stay under KV's 1024-byte metadata cap.
 */
export type SkillMdKvMetadata = Pick<
  SkillKvMeta,
  "etag" | "version" | "visibility" | "contentSha256"
>;

export function skillMdKvMetadata(meta: SkillKvMeta): SkillMdKvMetadata {
  return {
    etag: meta.etag,
    version: meta.version,
    visibility: meta.visibility,
    contentSha256: meta.contentSha256,
  };
}

export type SkillKvContent = {
  skillMd: string;
  meta: SkillKvMeta;
};
