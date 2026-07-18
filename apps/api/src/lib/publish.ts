import type { Env } from "../env";
import {
  type SkillKvContent,
  type SkillMdKvMetadata,
  skillMdKey,
  skillMdKvMetadata,
  skillMetaKey,
  skillVersionKey,
  skillVersionMetaKey,
  skillVersionPrefix,
} from "./kv";

export async function cachePublishedSkill(
  kv: KVNamespace,
  orgSlug: string,
  skillRepo: string,
  content: SkillKvContent,
): Promise<void> {
  await Promise.all([
    kv.put(skillMetaKey(orgSlug, skillRepo), JSON.stringify(content.meta)),
    kv.put(skillMdKey(orgSlug, skillRepo), content.skillMd, {
      metadata: skillMdKvMetadata(content.meta),
    }),
    cacheVersionSnapshot(kv, orgSlug, skillRepo, content),
  ]);
}

/**
 * Writes only the per-version (immutable) keys — used both by publish and by
 * lazy backfill of pre-feature versions on the versioned delivery path. Never
 * touches the `latest` keys, so backfilling an old version can't clobber the
 * current one.
 */
export async function cacheVersionSnapshot(
  kv: KVNamespace,
  orgSlug: string,
  skillRepo: string,
  content: SkillKvContent,
): Promise<void> {
  const version = content.meta.version;
  await Promise.all([
    kv.put(skillVersionMetaKey(orgSlug, skillRepo, version), JSON.stringify(content.meta)),
    kv.put(skillVersionKey(orgSlug, skillRepo, version), content.skillMd, {
      metadata: skillMdKvMetadata(content.meta),
    }),
  ]);
}

/**
 * Removes a skill from the public edge cache. Called when a skill is published
 * or rolled back while non-public, and when its visibility is changed away from
 * public, so the public delivery path stops serving it immediately.
 */
export async function purgePublishedSkill(
  kv: KVNamespace,
  orgSlug: string,
  skillRepo: string,
): Promise<void> {
  // Per-version keys must go too: a skill flipped away from public would
  // otherwise keep serving old pinned versions from the versioned path.
  const versionKeys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: skillVersionPrefix(orgSlug, skillRepo), cursor });
    versionKeys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  await Promise.all([
    kv.delete(skillMetaKey(orgSlug, skillRepo)),
    kv.delete(skillMdKey(orgSlug, skillRepo)),
    ...versionKeys.map((key) => kv.delete(key)),
  ]);
}

export async function getPublishedSkillMd(
  kv: KVNamespace,
  orgSlug: string,
  skillRepo: string,
): Promise<{ skillMd: string; meta: SkillMdKvMetadata } | null> {
  const { value: skillMd, metadata } = await kv.getWithMetadata<SkillMdKvMetadata>(
    skillMdKey(orgSlug, skillRepo),
  );
  if (!skillMd) return null;
  if (metadata?.etag) {
    return { skillMd, meta: metadata };
  }
  // Pre-metadata cache entry: fall back to the separate meta key until the
  // skill is republished (which writes per-key metadata).
  const metaRaw = await kv.get(skillMetaKey(orgSlug, skillRepo));
  if (!metaRaw) return null;
  return { skillMd, meta: JSON.parse(metaRaw) };
}

export async function getPublishedMeta(
  kv: KVNamespace,
  orgSlug: string,
  skillRepo: string,
): Promise<SkillKvContent["meta"] | null> {
  const metaRaw = await kv.get(skillMetaKey(orgSlug, skillRepo));
  if (!metaRaw) return null;
  return JSON.parse(metaRaw);
}

export async function getVersionSkillMd(
  kv: KVNamespace,
  orgSlug: string,
  skillRepo: string,
  version: string,
): Promise<{ skillMd: string; meta: SkillMdKvMetadata } | null> {
  const { value: skillMd, metadata } = await kv.getWithMetadata<SkillMdKvMetadata>(
    skillVersionKey(orgSlug, skillRepo, version),
  );
  if (!skillMd || !metadata?.etag) return null;
  return { skillMd, meta: metadata };
}

export async function getVersionMeta(
  kv: KVNamespace,
  orgSlug: string,
  skillRepo: string,
  version: string,
): Promise<SkillKvContent["meta"] | null> {
  const metaRaw = await kv.get(skillVersionMetaKey(orgSlug, skillRepo, version));
  if (!metaRaw) return null;
  return JSON.parse(metaRaw);
}

export async function broadcastPublish(
  env: Env,
  orgSlug: string,
  skillRepo: string,
  event: Record<string, unknown>,
): Promise<void> {
  const id = env.SKILL_HUB.idFromName(`${orgSlug}:${skillRepo}`);
  const stub = env.SKILL_HUB.get(id);
  await stub.fetch("http://internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
}
