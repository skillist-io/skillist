import {
  organizations,
  orgMembers,
  registryEntries,
  skillFiles,
  skillProvenance,
  skillSources,
  skills,
  skillVersions,
} from "@skillist/db/schema";
import {
  estimateImpactScore,
  extractAgentDiscovery,
  extractRegistryDiscovery,
  parsePluginManifest,
  resolveNextSemver,
  reviewSkillBundle,
  type SkillBundle,
  scanSkillSecurity,
  validateSkillBundle,
} from "@skillist/skill-format";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Env } from "../../env";
import { logAudit } from "../audit";
import type { WorkerDb } from "../db";
import { broadcastPublish, cachePublishedSkill } from "../publish";
import { queueSkillEval } from "../queue-eval";
import { putBundleObject, r2Prefix, sha256, uploadBundleToR2 } from "../r2";
import { detectSkillRuntime } from "../skill-runtime";
import { hashSkillTreeSnapshot, loadMirrorSkillBundle, sanitizeMirrorBundle } from "./bundle";
import { getCachedTree, putCachedTree } from "./cache";
import { DEFAULT_ROOTS, discoverSkillsFromTree } from "./discover";
import {
  assertMirrorLicenseAllowed,
  cacheTarballToR2,
  fetchCommitSha,
  fetchRepoMetadata,
  fetchRepoTree,
  type GithubTreeEntry,
} from "./fetch";
import { archiveRemovedMirrorSkills } from "./mirror-archive";

const MIRROR_ORG_POLICY = {
  minQualityScore: 0,
  requireSecurityPass: false,
  blockOnAdvisory: false,
  requireEval: false,
} as const;

export type MirrorPublishInput = {
  sourceId: string;
  skillSlug: string;
  sourcePath: string;
  commitSha: string;
};

export type SyncSourceResult = {
  sourceId: string;
  commitSha: string | null;
  skipped: boolean;
  reason?: string;
  changedSkills: {
    skillSlug: string;
    sourcePath: string;
    contentHash: string;
  }[];
  discoveredCount: number;
};

async function ensureMirrorOrg(
  db: WorkerDb,
  githubOwner: string,
): Promise<{ id: string; slug: string }> {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, githubOwner))
    .limit(1);
  if (existing) {
    // Mirror orgs are created here with no members. A slug that already belongs
    // to a member-bearing org is a user-created org (possibly slug-squatted to
    // match a GitHub owner) — refuse to publish mirrored skills into it, which
    // would hand that user owner control over the mirror.
    const [member] = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, existing.id))
      .limit(1);
    if (member) {
      throw new Error(
        `Refusing to mirror into org slug "${githubOwner}": it is claimed by a user-owned org.`,
      );
    }
    return { id: existing.id, slug: existing.slug };
  }

  const [created] = await db
    .insert(organizations)
    .values({
      name: githubOwner,
      slug: githubOwner,
      publishPolicy: { ...MIRROR_ORG_POLICY },
    })
    .returning();
  return { id: created!.id, slug: created!.slug };
}

async function loadTree(
  env: Env,
  owner: string,
  repo: string,
  commitSha: string,
): Promise<GithubTreeEntry[]> {
  const cached = await getCachedTree(env.SKILLS_KV, owner, repo, commitSha);
  if (cached) return cached;
  const tree = await fetchRepoTree(owner, repo, commitSha, env.GITHUB_TOKEN);
  await putCachedTree(env.SKILLS_KV, owner, repo, commitSha, tree);
  return tree;
}

/**
 * Orchestrate sync for one curated source: fetch → cache → discover → diff.
 * Returns changed skills for the queue to publish (and eval).
 */
export async function syncSource(
  env: Env,
  db: WorkerDb,
  sourceId: string,
): Promise<SyncSourceResult> {
  const [source] = await db
    .select()
    .from(skillSources)
    .where(eq(skillSources.id, sourceId))
    .limit(1);
  if (!source) throw new Error(`skill_sources ${sourceId} not found`);
  if (!source.syncEnabled) {
    return {
      sourceId,
      commitSha: null,
      skipped: true,
      reason: "sync_disabled",
      changedSkills: [],
      discoveredCount: 0,
    };
  }

  await db
    .update(skillSources)
    .set({ lastSyncStatus: "running", lastSyncError: null, updatedAt: new Date() })
    .where(eq(skillSources.id, sourceId));

  try {
    const meta = await fetchRepoMetadata(source.githubOwner, source.githubRepo, env.GITHUB_TOKEN);
    assertMirrorLicenseAllowed(meta.license, source.trustTier);

    const branch = source.defaultBranch || meta.defaultBranch;
    const commitSha = await fetchCommitSha(
      source.githubOwner,
      source.githubRepo,
      branch,
      env.GITHUB_TOKEN,
    );

    await db
      .update(skillSources)
      .set({
        license: meta.license,
        homepageUrl: meta.homepageUrl,
        updatedAt: new Date(),
      })
      .where(eq(skillSources.id, sourceId));

    if (
      source.lastCommitSha === commitSha &&
      source.lastSyncStatus === "success" &&
      source.pendingPublishCount === 0
    ) {
      await db
        .update(skillSources)
        .set({
          lastSyncedAt: new Date(),
          lastSyncStatus: "success",
          updatedAt: new Date(),
        })
        .where(eq(skillSources.id, sourceId));
      return {
        sourceId,
        commitSha,
        skipped: true,
        reason: "unchanged_commit",
        changedSkills: [],
        discoveredCount: 0,
      };
    }

    try {
      await cacheTarballToR2(
        env.SKILLS_R2,
        source.githubOwner,
        source.githubRepo,
        commitSha,
        env.GITHUB_TOKEN,
      );
    } catch (err) {
      // Tarball cache is an optimization; tree/blob fetch still works.
      console.warn(
        JSON.stringify({
          msg: "tarball_cache_failed",
          repo: `${source.githubOwner}/${source.githubRepo}`,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    const tree = await loadTree(env, source.githubOwner, source.githubRepo, commitSha);
    const discovered = discoverSkillsFromTree(tree, source.discoveryRoots ?? DEFAULT_ROOTS);
    const org = await ensureMirrorOrg(db, source.githubOwner);

    const existingSkills = await db
      .select({ id: skills.id, repo: skills.repo })
      .from(skills)
      .where(eq(skills.orgId, org.id));
    const skillIdByRepo = new Map(existingSkills.map((row) => [row.repo, row.id]));
    const skillIds = existingSkills.map((row) => row.id);

    const provenanceBySkillId = new Map<string, string>();
    if (skillIds.length > 0) {
      const provenanceRows = await db
        .select({ skillId: skillProvenance.skillId, contentHash: skillProvenance.contentHash })
        .from(skillProvenance)
        .where(inArray(skillProvenance.skillId, skillIds));
      for (const row of provenanceRows) {
        provenanceBySkillId.set(row.skillId, row.contentHash);
      }
    }

    const changedSkills: SyncSourceResult["changedSkills"] = [];

    for (const skill of discovered) {
      const contentHash = await hashSkillTreeSnapshot(tree, skill.sourcePath);
      const existingSkillId = skillIdByRepo.get(skill.skillSlug);
      if (existingSkillId && provenanceBySkillId.get(existingSkillId) === contentHash) {
        continue;
      }

      changedSkills.push({
        skillSlug: skill.skillSlug,
        sourcePath: skill.sourcePath,
        contentHash,
      });
    }

    await archiveRemovedMirrorSkills(
      db,
      sourceId,
      org.id,
      new Set(discovered.map((skill) => skill.skillSlug)),
    );

    return {
      sourceId,
      commitSha,
      skipped: false,
      changedSkills,
      discoveredCount: discovered.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    await db
      .update(skillSources)
      .set({
        lastSyncStatus: "failed",
        lastSyncError: message,
        updatedAt: new Date(),
      })
      .where(eq(skillSources.id, sourceId));
    throw err;
  }
}

export async function finalizeSourceSync(
  db: WorkerDb,
  sourceId: string,
  commitSha: string,
): Promise<void> {
  await db
    .update(skillSources)
    .set({
      lastSyncedAt: new Date(),
      lastCommitSha: commitSha,
      lastSyncStatus: "success",
      lastSyncError: null,
      pendingCommitSha: null,
      pendingPublishCount: 0,
      updatedAt: new Date(),
    })
    .where(eq(skillSources.id, sourceId));
}

export async function beginSourcePublishBatch(
  db: WorkerDb,
  sourceId: string,
  commitSha: string,
  publishCount: number,
): Promise<void> {
  await db
    .update(skillSources)
    .set({
      pendingCommitSha: commitSha,
      pendingPublishCount: publishCount,
      lastSyncStatus: "running",
      lastSyncError: null,
      updatedAt: new Date(),
    })
    .where(eq(skillSources.id, sourceId));
}

export async function recordPublishJobSuccess(
  db: WorkerDb,
  sourceId: string,
  commitSha: string,
): Promise<boolean> {
  const [row] = await db
    .update(skillSources)
    .set({
      pendingPublishCount: sql`${skillSources.pendingPublishCount} - 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(skillSources.id, sourceId),
        eq(skillSources.pendingCommitSha, commitSha),
        sql`${skillSources.pendingPublishCount} > 0`,
      ),
    )
    .returning({
      pendingPublishCount: skillSources.pendingPublishCount,
    });

  return row?.pendingPublishCount === 0;
}

export async function recordPublishJobFailure(
  db: WorkerDb,
  sourceId: string,
  commitSha: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : "Publish failed";
  await db
    .update(skillSources)
    .set({
      lastSyncStatus: "failed",
      lastSyncError: message,
      pendingCommitSha: null,
      pendingPublishCount: 0,
      updatedAt: new Date(),
    })
    .where(and(eq(skillSources.id, sourceId), eq(skillSources.pendingCommitSha, commitSha)));
}

/**
 * Publish one mirrored skill from a GitHub tree, then queue a Skillist eval.
 */
export async function mirrorPublishSkill(
  env: Env,
  db: WorkerDb,
  input: MirrorPublishInput,
): Promise<{
  orgSlug: string;
  skillRepo: string;
  version: string;
  versionId: string;
  evalQueued: boolean;
}> {
  const [source] = await db
    .select()
    .from(skillSources)
    .where(eq(skillSources.id, input.sourceId))
    .limit(1);
  if (!source) throw new Error(`skill_sources ${input.sourceId} not found`);

  const org = await ensureMirrorOrg(db, source.githubOwner);
  const tree = await loadTree(env, source.githubOwner, source.githubRepo, input.commitSha);
  const rawBundle = await loadMirrorSkillBundle(
    env.SKILLS_R2,
    source.githubOwner,
    source.githubRepo,
    input.commitSha,
    input.sourcePath,
    tree,
    env.GITHUB_TOKEN,
  );
  const bundle = sanitizeMirrorBundle(rawBundle);

  const validation = validateSkillBundle(bundle, input.skillSlug);
  if (!validation.valid) {
    throw new Error(validation.errors.map((e) => e.message).join("; "));
  }

  const review = reviewSkillBundle(bundle, input.skillSlug);
  const impactScore = estimateImpactScore(review);
  const security = scanSkillSecurity(bundle);
  if (security.status === "fail") {
    throw new Error(
      `Security scan failed for ${org.slug}/${input.skillSlug}: ${security.issues.map((i) => i.message).join("; ")}`,
    );
  }

  const pluginRaw = bundle.get("plugin.json");
  const pluginManifest = pluginRaw ? parsePluginManifest(pluginRaw) : null;
  const compatibleAgents = extractAgentDiscovery(pluginManifest);
  const discovery = extractRegistryDiscovery(validation.frontmatter);
  const contentHash = await hashSkillTreeSnapshot(tree, input.sourcePath);
  const upstreamRepo = `${source.githubOwner}/${source.githubRepo}`;
  const upstreamUrl = `https://github.com/${upstreamRepo}/tree/${input.commitSha}/${input.sourcePath}`;

  let [skill] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, org.id), eq(skills.repo, input.skillSlug)))
    .limit(1);

  if (!skill) {
    const [created] = await db
      .insert(skills)
      .values({
        orgId: org.id,
        repo: input.skillSlug,
        visibility: "public",
        description: validation.frontmatter.description,
        runtime: detectSkillRuntime(bundle),
      })
      .returning();
    skill = created!;
  } else {
    // Mirror is authoritative for these slugs
    await db
      .update(skills)
      .set({
        visibility: "public",
        description: validation.frontmatter.description,
        runtime: detectSkillRuntime(bundle),
        updatedAt: new Date(),
      })
      .where(eq(skills.id, skill.id));
  }

  const [latest] = skill.latestPublishedVersionId
    ? await db
        .select()
        .from(skillVersions)
        .where(eq(skillVersions.id, skill.latestPublishedVersionId))
        .limit(1)
    : [];

  const semver = resolveNextSemver(latest?.semver, { bump: "patch" });
  const versionId = crypto.randomUUID();
  const prefix = r2Prefix(org.id, input.skillSlug, versionId);

  await uploadBundleToR2(env.SKILLS_R2, prefix, bundle);

  const fileRows = await Promise.all(
    [...bundle.entries()].map(async ([path, content]) => ({
      versionId,
      path,
      sha256: await sha256(content),
      size: new TextEncoder().encode(content).byteLength,
    })),
  );

  await db.insert(skillVersions).values({
    id: versionId,
    skillId: skill.id,
    status: "draft",
    semver,
    r2Prefix: prefix,
    reviewChecks: review.checks.map(({ id, label, passed, message }) => ({
      id,
      label,
      passed,
      message,
    })),
    qualityScore: review.score,
    impactScore,
    securityStatus: security.status,
    securityIssues: security.issues,
    pluginManifest: pluginManifest ?? null,
    parentVersionId: latest?.id ?? null,
  });

  if (fileRows.length) {
    await db.insert(skillFiles).values(fileRows);
  }

  const skillMd = bundle.get("SKILL.md")!;
  const contentSha256 = await sha256(skillMd);
  const etag = contentSha256.slice(0, 16);
  const publishedAt = new Date().toISOString();
  const bundleKey = await putBundleObject(env.SKILLS_R2, prefix, bundle, semver);

  await cachePublishedSkill(env.SKILLS_KV, org.slug, input.skillSlug, {
    skillMd,
    meta: {
      name: validation.frontmatter.name,
      description: validation.frontmatter.description,
      version: semver,
      versionId,
      etag,
      org: org.slug,
      repo: input.skillSlug,
      publishedAt,
      // Mirror skills are always public (enforced on the skills row above);
      // the delivery path fails closed without this.
      visibility: "public",
      sourceType: "mirror",
      upstreamRepo,
      upstreamUrl,
      contentSha256,
      bundleKey,
    },
  });

  await db
    .update(skillVersions)
    .set({ status: "archived" })
    .where(and(eq(skillVersions.skillId, skill.id), eq(skillVersions.status, "published")));

  await db
    .update(skillVersions)
    .set({
      status: "published",
      publishedAt: new Date(),
      kvEtag: etag,
    })
    .where(eq(skillVersions.id, versionId));

  await db
    .update(skills)
    .set({
      latestPublishedVersionId: versionId,
      updatedAt: new Date(),
    })
    .where(eq(skills.id, skill.id));

  await db
    .insert(registryEntries)
    .values({
      skillId: skill.id,
      orgSlug: org.slug,
      skillRepo: input.skillSlug,
      name: validation.frontmatter.name,
      description: validation.frontmatter.description,
      latestVersion: semver,
      qualityScore: review.score,
      impactScore,
      securityStatus: security.status,
      category: discovery.category,
      tags: discovery.tags,
      compatibleAgents,
      sourceType: "mirror",
      upstreamRepo,
      upstreamUrl,
      lastReviewedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: registryEntries.skillId,
      set: {
        name: validation.frontmatter.name,
        description: validation.frontmatter.description,
        latestVersion: semver,
        qualityScore: review.score,
        impactScore,
        securityStatus: security.status,
        category: discovery.category,
        tags: discovery.tags,
        compatibleAgents,
        sourceType: "mirror",
        upstreamRepo,
        upstreamUrl,
        lastReviewedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  await db
    .insert(skillProvenance)
    .values({
      skillId: skill.id,
      sourceId: source.id,
      sourcePath: input.sourcePath,
      sourceCommitSha: input.commitSha,
      sourceUrl: upstreamUrl,
      contentHash,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: skillProvenance.skillId,
      set: {
        sourceId: source.id,
        sourcePath: input.sourcePath,
        sourceCommitSha: input.commitSha,
        sourceUrl: upstreamUrl,
        contentHash,
        syncedAt: new Date(),
      },
    });

  await logAudit(db, {
    orgId: org.id,
    actorId: null,
    actorType: "system",
    action: "skill.mirrored",
    resourceType: "skill",
    resourceId: skill.id,
    metadata: {
      repo: input.skillSlug,
      version: semver,
      upstreamRepo,
      commitSha: input.commitSha,
      sourceType: "mirror",
    },
  });

  await broadcastPublish(env, org.slug, input.skillSlug, {
    type: "skill.published",
    org: org.slug,
    repo: input.skillSlug,
    version: semver,
    versionId,
    etag,
    publishedAt,
    sourceType: "mirror",
  });

  // Run Skillist's own evals against mirrored skills (async; does not block sync)
  const evalResult = await queueSkillEval(env, db, {
    skillId: skill.id,
    versionId,
    orgSlug: org.slug,
    skillRepo: input.skillSlug,
  });

  return {
    orgSlug: org.slug,
    skillRepo: input.skillSlug,
    version: semver,
    versionId,
    evalQueued: evalResult.created || evalResult.status === "queued",
  };
}

export async function listEnabledSourceIds(db: WorkerDb): Promise<string[]> {
  const rows = await db
    .select({ id: skillSources.id })
    .from(skillSources)
    .where(eq(skillSources.syncEnabled, true));
  return rows.map((r) => r.id);
}

export type { SkillBundle };
