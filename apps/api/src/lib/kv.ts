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
};

export type SkillKvContent = {
  skillMd: string;
  meta: SkillKvMeta;
};
