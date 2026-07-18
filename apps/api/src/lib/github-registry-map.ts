import { organizations, registryEntries, skills } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import type { WorkerDb } from "./db";

export type RegistryRef = {
  registryOrgSlug: string;
  registryRepo: string;
};

/**
 * Resolve a GitHub-style `owner/repo` (and optional local skill folder name)
 * to a Skillist registry identity.
 *
 * Matching order:
 * 1. Explicit registryOrgSlug + registryRepo if both provided
 * 2. Exact registry entry for owner/repo as org/skill
 * 3. Registry entry for owner + localSlug (when skill folder name ≠ repo name)
 */
export async function resolveGithubToRegistry(
  db: WorkerDb,
  input: {
    repoFullName: string;
    localSlug?: string | null;
    registryOrgSlug?: string | null;
    registryRepo?: string | null;
  },
): Promise<RegistryRef | null> {
  if (input.registryOrgSlug && input.registryRepo) {
    const [hit] = await db
      .select({
        orgSlug: registryEntries.orgSlug,
        skillRepo: registryEntries.skillRepo,
      })
      .from(registryEntries)
      .where(
        and(
          eq(registryEntries.orgSlug, input.registryOrgSlug),
          eq(registryEntries.skillRepo, input.registryRepo),
        ),
      )
      .limit(1);
    if (hit) {
      return { registryOrgSlug: hit.orgSlug, registryRepo: hit.skillRepo };
    }
  }

  const [owner, name] = input.repoFullName.split("/");
  if (!owner || !name) return null;

  const candidates = [name];
  if (input.localSlug && input.localSlug !== name) {
    candidates.push(input.localSlug);
  }

  for (const repo of candidates) {
    const [hit] = await db
      .select({
        orgSlug: registryEntries.orgSlug,
        skillRepo: registryEntries.skillRepo,
      })
      .from(registryEntries)
      .where(and(eq(registryEntries.orgSlug, owner), eq(registryEntries.skillRepo, repo)))
      .limit(1);
    if (hit) {
      return { registryOrgSlug: hit.orgSlug, registryRepo: hit.skillRepo };
    }
  }

  // Fall back to unpublished skills table (same org/repo identity)
  const [orgRow] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, owner))
    .limit(1);
  if (!orgRow) return null;

  for (const repo of candidates) {
    const [skill] = await db
      .select({ repo: skills.repo })
      .from(skills)
      .where(and(eq(skills.orgId, orgRow.id), eq(skills.repo, repo)))
      .limit(1);
    if (skill) {
      return { registryOrgSlug: owner, registryRepo: skill.repo };
    }
  }

  return null;
}

export function skillistDeliveryUrls(org: string, repo: string) {
  const base = `https://skillist.io/${org}/${repo}`;
  return {
    pageUrl: base,
    skillMdUrl: `${base}/SKILL.md`,
    metaUrl: `${base}/meta`,
    bundleUrl: `${base}/bundle`,
  };
}
