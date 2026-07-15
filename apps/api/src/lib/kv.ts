export function skillMetaKey(orgSlug: string, skillSlug: string) {
  return `skill:${orgSlug}:${skillSlug}:meta`;
}

export function skillMdKey(orgSlug: string, skillSlug: string) {
  return `skill:${orgSlug}:${skillSlug}:latest`;
}

export function skillVersionKey(
  orgSlug: string,
  skillSlug: string,
  version: string,
) {
  return `skill:${orgSlug}:${skillSlug}:v:${version}`;
}

export type SkillKvMeta = {
  name: string;
  description: string;
  version: string;
  versionId: string;
  etag: string;
  org: string;
  slug: string;
  publishedAt: string;
};

export type SkillKvContent = {
  skillMd: string;
  meta: SkillKvMeta;
};
