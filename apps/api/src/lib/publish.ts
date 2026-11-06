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
 * Removes a skill's delivery keys from KV. Called when a skill is published or
 * rolled back while non-public, and when its visibility is changed away from
 * public. This only clears KV: responses already in the Worker's cache keep
 * being served until purgeDeliveryCache runs.
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

// Keep hot delivery reads in each colo's edge cache so repeat reads skip the
// central KV store. A write revalidates KV's regional and central cache tiers,
// so a publish is visible quickly — but this is still the outer bound on how
// stale a `latest` read can be, so it matches the `max-age=60` that
// LATEST_CACHE_CONTROL promises rather than exceeding it (it was 300, five
// times the advertised freshness window).
const DELIVERY_KV_CACHE_TTL = 60;

// Pinned content never changes, but a pinned key can still be deleted when a
// skill leaves public, and a read keeps its cached copy until cacheTtl ends. This
// value is how long a retracted skill can stay readable in a colo, so it stays
// short. Workers Caching absorbs repeat reads, so only cache misses get here.
const VERSION_KV_CACHE_TTL = 60;

/**
 * Removes a skill from the Worker's own cache (`cache` in
 * wrangler.production.jsonc). Zone purges don't reach this cache, so without
 * this call a retracted skill's cached responses keep being served: `/bundle`
 * for about an hour, through stale-while-revalidate.
 *
 * Call it after the KV and registry rows are gone, or a request can re-cache the
 * old content. The retraction is already committed by then, so a failure is
 * logged rather than thrown; retrying the visibility change purges again.
 */
export async function purgeDeliveryCache(
  cache: CacheContext | undefined,
  orgSlug: string,
  skillRepo: string,
): Promise<void> {
  const pathPrefixes = [
    `/${orgSlug}/${skillRepo}/`,
    // Pinned URLs. The cache matches the path as requested, so cover both forms.
    `/${orgSlug}/${skillRepo}@`,
    `/${orgSlug}/${skillRepo}%40`,
    // Browse pages list the skill. Retractions are rare, so dropping them all is
    // cheaper than tracking which ones it appears on.
    "/v1/registry",
  ];
  try {
    if (!cache) throw new Error("ctx.cache is unavailable");
    const result = await cache.purge({ pathPrefixes });
    if (!result.success) throw new Error(JSON.stringify(result.errors));
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "delivery cache purge failed",
        org: orgSlug,
        repo: skillRepo,
        error: String(error),
      }),
    );
  }
}

export async function getPublishedSkillMd(
  kv: KVNamespace,
  orgSlug: string,
  skillRepo: string,
): Promise<{ skillMd: string; meta: SkillMdKvMetadata } | null> {
  const { value: skillMd, metadata } = await kv.getWithMetadata<SkillMdKvMetadata>(
    skillMdKey(orgSlug, skillRepo),
    { cacheTtl: DELIVERY_KV_CACHE_TTL },
  );
  if (!skillMd) return null;
  if (metadata?.etag) {
    return { skillMd, meta: metadata };
  }
  // Pre-metadata cache entry: fall back to the separate meta key until the
  // skill is republished (which writes per-key metadata).
  const metaRaw = await kv.get(skillMetaKey(orgSlug, skillRepo), {
    cacheTtl: DELIVERY_KV_CACHE_TTL,
  });
  if (!metaRaw) return null;
  return { skillMd, meta: JSON.parse(metaRaw) };
}

export async function getPublishedMeta(
  kv: KVNamespace,
  orgSlug: string,
  skillRepo: string,
): Promise<SkillKvContent["meta"] | null> {
  const metaRaw = await kv.get(skillMetaKey(orgSlug, skillRepo), {
    cacheTtl: DELIVERY_KV_CACHE_TTL,
  });
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
    { cacheTtl: VERSION_KV_CACHE_TTL },
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
  const metaRaw = await kv.get(skillVersionMetaKey(orgSlug, skillRepo, version), {
    cacheTtl: VERSION_KV_CACHE_TTL,
  });
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
