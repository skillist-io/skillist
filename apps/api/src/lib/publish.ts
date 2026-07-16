import type { Env } from "../env";
import { skillMdKey, skillMetaKey, type SkillKvContent } from "./kv";

export async function cachePublishedSkill(
  kv: KVNamespace,
  orgSlug: string,
  skillRepo: string,
  content: SkillKvContent,
): Promise<void> {
  await Promise.all([
    kv.put(skillMetaKey(orgSlug, skillRepo), JSON.stringify(content.meta)),
    kv.put(skillMdKey(orgSlug, skillRepo), content.skillMd),
  ]);
}

export async function getPublishedSkillMd(
  kv: KVNamespace,
  orgSlug: string,
  skillRepo: string,
): Promise<{ skillMd: string; meta: SkillKvContent["meta"] } | null> {
  const [skillMd, metaRaw] = await Promise.all([
    kv.get(skillMdKey(orgSlug, skillRepo)),
    kv.get(skillMetaKey(orgSlug, skillRepo)),
  ]);
  if (!skillMd || !metaRaw) return null;
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
