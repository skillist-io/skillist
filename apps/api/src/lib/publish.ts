import type { Env } from "../env";
import {
  type SkillKvContent,
  type SkillMdKvMetadata,
  skillMdKey,
  skillMdKvMetadata,
  skillMetaKey,
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
  await Promise.all([
    kv.delete(skillMetaKey(orgSlug, skillRepo)),
    kv.delete(skillMdKey(orgSlug, skillRepo)),
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
