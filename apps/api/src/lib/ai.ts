import {
  aiJobs,
  feedback,
  organizations,
  registryEntries,
  skillFiles,
  skills,
  skillVersions,
} from "@skillist/db/schema";
import type {
  PluginManifest,
  SecurityScanResult,
  SkillBundle,
  SkillFrontmatter,
  SkillReviewResult,
} from "@skillist/skill-format";
import {
  bumpSemver,
  estimateImpactScore,
  extractAgentDiscovery,
  extractRegistryDiscovery,
  parsePluginManifest,
  reviewSkillBundle,
  scanSkillSecurity,
  validateSkillBundle,
} from "@skillist/skill-format";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Env } from "../env";
import { logAudit } from "./audit";
import type { WorkerDb } from "./db";
import { runModel } from "./model";
import { broadcastPublish, cachePublishedSkill, purgePublishedSkill } from "./publish";
import { evaluatePublishPolicy } from "./publish-policy";
import { getVersionEvalStatus, queueSkillEval } from "./queue-eval";
import {
  downloadBundleFromR2,
  listBundlePaths,
  putBundleObject,
  r2Prefix,
  sha256,
  uploadBundleToR2,
} from "./r2";
import { detectSkillRuntime } from "./skill-runtime";

/**
 * Formats 64 hex chars (a sha256) into a valid RFC 4122 v4-variant UUID string.
 * Deterministic: the same seed always yields the same UUID.
 */
function uuidFromHex(hex: string): string {
  const h = hex.padEnd(32, "0");
  const variant = ((Number.parseInt(h[16] ?? "8", 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function runAiJob(
  env: Env,
  db: WorkerDb,
  jobId: string,
  feedbackId: string,
): Promise<void> {
  // Idempotency: a retried job that already produced its draft must not run the
  // model again or create a second draft version.
  const [existingJob] = await db.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1);
  if (existingJob?.status === "completed" && existingJob.resultDraftVersionId) return;

  const [job] = await db.select().from(feedback).where(eq(feedback.id, feedbackId)).limit(1);
  if (!job) return;

  // skill and version are independent once the feedback row is loaded.
  const [[skill], [version]] = await Promise.all([
    db.select().from(skills).where(eq(skills.id, job.skillId)).limit(1),
    db.select().from(skillVersions).where(eq(skillVersions.id, job.targetVersionId)).limit(1),
  ]);
  if (!skill || !version) return;

  const paths = await listBundlePaths(env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(env.SKILLS_R2, version.r2Prefix, paths);
  const skillMd = bundle.get("SKILL.md") ?? "";

  const prompt = `You are improving an Agent Skill per agentskills.io spec.
Current SKILL.md:
${skillMd}

Feedback:
${job.body}

Return ONLY the complete improved SKILL.md file with valid YAML frontmatter.`;

  let improvedMd: string;
  try {
    improvedMd = (await runModel(env, prompt)) || skillMd;
  } catch (err) {
    await db.update(feedback).set({ status: "pending" }).where(eq(feedback.id, feedbackId));
    throw err;
  }

  const newBundle = new Map(bundle);
  newBundle.set("SKILL.md", improvedMd);
  const validation = validateSkillBundle(newBundle, skill.repo);
  if (!validation.valid) {
    throw new Error("AI output failed validation");
  }

  // Deterministic draft id from the job id: a retry reuses the same version id
  // and R2 prefix, so re-running overwrites rather than accumulating duplicate
  // drafts and orphaned R2 objects.
  const versionId = uuidFromHex(await sha256(`aijob:${jobId}`));
  const prefix = r2Prefix(skill.orgId, skill.repo, versionId);
  await uploadBundleToR2(env.SKILLS_R2, prefix, newBundle);

  const fileEntries = [...newBundle.entries()];
  // Hash in parallel outside the transaction (pure CPU, no DB round-trips).
  const fileRows = await Promise.all(
    fileEntries.map(async ([path, content]) => ({
      versionId,
      path,
      sha256: await sha256(content),
      size: content.length,
    })),
  );

  // Version row, file rows, and job completion move together; onConflictDoNothing
  // makes the insert half idempotent under retry (deterministic ids above).
  await db.transaction(async (tx) => {
    await tx
      .insert(skillVersions)
      .values({
        id: versionId,
        skillId: skill.id,
        status: "draft",
        semver: bumpSemver(version.semver, "patch"),
        r2Prefix: prefix,
        parentVersionId: version.id,
        createdBy: job.submittedBy,
      })
      .onConflictDoNothing();

    if (fileRows.length > 0) {
      await tx.insert(skillFiles).values(fileRows).onConflictDoNothing();
    }

    await tx
      .update(aiJobs)
      .set({
        status: "completed",
        resultDraftVersionId: versionId,
        completedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId));
  });
}

/**
 * Shared tail for publish and rollback: both take a validated, reviewed,
 * security-scanned bundle and make it the live published version. The DB
 * mutations (archive the previous published version, mark this one published,
 * move the skill's live pointer, upsert the public registry entry) run in a
 * single transaction, so a mid-sequence failure can't leave the skill
 * half-published. KV is written only after the transaction commits — and only
 * for public skills — so the public edge can never advertise a version the
 * database rolled back, and a private/org skill is purged from the edge rather
 * than cached there.
 */
async function commitPublishedVersion(params: {
  env: Env;
  db: WorkerDb;
  skill: typeof skills.$inferSelect;
  org: typeof organizations.$inferSelect;
  version: typeof skillVersions.$inferSelect;
  bundle: SkillBundle;
  frontmatter: SkillFrontmatter;
  review: SkillReviewResult;
  impactScore: number;
  security: SecurityScanResult;
  pluginManifest: PluginManifest | null;
  compatibleAgents: string[];
  userId: string | null;
  actorType: "user" | "api_key";
  action: "skill.published" | "skill.rolled_back";
  auditMetadata: Record<string, unknown>;
}): Promise<{
  etag: string;
  version: string;
  qualityScore: number;
  impactScore: number;
  securityStatus: string;
}> {
  const {
    env,
    db,
    skill,
    org,
    version,
    bundle,
    frontmatter,
    review,
    impactScore,
    security,
    pluginManifest,
    compatibleAgents,
    userId,
    actorType,
    action,
    auditMetadata,
  } = params;

  const isPublic = skill.visibility === "public";
  const reviewChecks = review.checks.map(({ id, label, passed, message }) => ({
    id,
    label,
    passed,
    message,
  }));
  const skillMd = bundle.get("SKILL.md") ?? "";
  const contentSha256 = await sha256(skillMd);
  const etag = contentSha256.slice(0, 16);
  const publishedAt = new Date().toISOString();
  const runtime = detectSkillRuntime(bundle);
  const discovery = extractRegistryDiscovery(frontmatter);

  await db.transaction(async (tx) => {
    // Serialize concurrent publishes of the same skill. Without this lock two
    // publishes can interleave: each archives the other's not-yet-committed
    // "published" version and races to set latestPublishedVersionId. Locking the
    // skills row up front makes the archive → publish → set-latest sequence atomic.
    await tx.execute(sql`select id from skills where id = ${skill.id} for update`);

    await tx
      .update(skillVersions)
      .set({ status: "archived" })
      .where(
        and(
          eq(skillVersions.skillId, skill.id),
          eq(skillVersions.status, "published"),
          ne(skillVersions.id, version.id),
        ),
      );

    await tx
      .update(skillVersions)
      .set({
        status: "published",
        publishedAt: new Date(),
        kvEtag: etag,
        qualityScore: review.score,
        impactScore,
        securityStatus: security.status,
        securityIssues: security.issues,
        reviewChecks,
        pluginManifest: pluginManifest ?? null,
      })
      .where(eq(skillVersions.id, version.id));

    await tx
      .update(skills)
      .set({
        latestPublishedVersionId: version.id,
        description: frontmatter.description,
        runtime,
        updatedAt: new Date(),
      })
      .where(eq(skills.id, skill.id));

    if (isPublic) {
      await tx
        .insert(registryEntries)
        .values({
          skillId: skill.id,
          orgSlug: org.slug,
          skillRepo: skill.repo,
          name: frontmatter.name,
          description: frontmatter.description,
          latestVersion: version.semver,
          qualityScore: review.score,
          impactScore,
          securityStatus: security.status,
          category: discovery.category,
          tags: discovery.tags,
          compatibleAgents,
          lastReviewedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: registryEntries.skillId,
          set: {
            name: frontmatter.name,
            description: frontmatter.description,
            latestVersion: version.semver,
            qualityScore: review.score,
            impactScore,
            securityStatus: security.status,
            category: discovery.category,
            tags: discovery.tags,
            compatibleAgents,
            lastReviewedAt: new Date(),
            updatedAt: new Date(),
          },
        });
    }
  });

  // KV is edge-eventual and non-transactional, so write it only after the DB
  // commit — otherwise a rolled-back transaction would leave the edge serving a
  // version the DB no longer considers published.
  if (isPublic) {
    // Materialize the bundle object before KV points at it.
    const bundleKey = await putBundleObject(
      env.SKILLS_R2,
      version.r2Prefix,
      bundle,
      version.semver,
    );
    await cachePublishedSkill(env.SKILLS_KV, org.slug, skill.repo, {
      skillMd,
      meta: {
        name: frontmatter.name,
        description: frontmatter.description,
        version: version.semver,
        versionId: version.id,
        etag,
        org: org.slug,
        repo: skill.repo,
        publishedAt,
        visibility: "public",
        contentSha256,
        bundleKey,
      },
    });
  } else {
    await purgePublishedSkill(env.SKILLS_KV, org.slug, skill.repo);
  }

  const event = {
    type: "skill.published" as const,
    org: org.slug,
    repo: skill.repo,
    version: version.semver,
    versionId: version.id,
    etag,
    publishedAt,
    // Never fan out private/org skill contents over the realtime hub.
    skillMd: isPublic && skillMd.length < 65536 ? skillMd : undefined,
  };
  // The audit write (DB) and the realtime broadcast (DO) are independent, so run
  // them together. The broadcast is best-effort: the version is already committed
  // to the DB and KV above, so a transient Durable Object error must not fail the
  // publish (which would return HTTP 400 to the caller for a skill that is live).
  await Promise.all([
    logAudit(db, {
      orgId: org.id,
      actorId: userId,
      actorType,
      action,
      resourceType: "skill",
      resourceId: skill.id,
      metadata: auditMetadata,
    }),
    broadcastPublish(env, org.slug, skill.repo, event).catch((err) => {
      console.error(
        JSON.stringify({
          msg: "broadcast_publish_failed",
          org: org.slug,
          repo: skill.repo,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }),
  ]);

  return {
    etag,
    version: version.semver,
    qualityScore: review.score,
    impactScore,
    securityStatus: security.status,
  };
}

/**
 * Re-syncs the public edge cache for a skill's current live version to match
 * its visibility — used after a visibility change. Caches SKILL.md/meta when
 * the skill is public with a live version, and purges the edge otherwise so a
 * skill flipped to private/org stops being served from the public path.
 */
export async function syncSkillEdge(env: Env, db: WorkerDb, skillId: string): Promise<void> {
  const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
  if (!skill) return;
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, skill.orgId))
    .limit(1);
  if (!org) return;

  if (skill.visibility !== "public" || !skill.latestPublishedVersionId) {
    await purgePublishedSkill(env.SKILLS_KV, org.slug, skill.repo);
    return;
  }

  const [version] = await db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, skill.latestPublishedVersionId))
    .limit(1);
  if (!version) {
    await purgePublishedSkill(env.SKILLS_KV, org.slug, skill.repo);
    return;
  }

  const paths = await listBundlePaths(env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(env.SKILLS_R2, version.r2Prefix, paths);
  const skillMd = bundle.get("SKILL.md") ?? "";
  const parsed = validateSkillBundle(bundle, skill.repo);
  const name = parsed.valid ? parsed.frontmatter.name : skill.repo;
  const description = parsed.valid ? parsed.frontmatter.description : (skill.description ?? "");
  const contentSha256 = await sha256(skillMd);
  const etag = version.kvEtag ?? contentSha256.slice(0, 16);
  const bundleKey = await putBundleObject(env.SKILLS_R2, version.r2Prefix, bundle, version.semver);

  await cachePublishedSkill(env.SKILLS_KV, org.slug, skill.repo, {
    skillMd,
    meta: {
      name,
      description,
      version: version.semver,
      versionId: version.id,
      etag,
      org: org.slug,
      repo: skill.repo,
      publishedAt: (version.publishedAt ?? new Date()).toISOString(),
      visibility: "public",
      contentSha256,
      bundleKey,
    },
  });
}

export async function publishVersion(
  env: Env,
  db: WorkerDb,
  skillId: string,
  versionId: string,
  userId: string | null,
  actorType: "user" | "api_key" = "user",
): Promise<{
  etag: string;
  version: string;
  qualityScore: number;
  impactScore: number;
  securityStatus: string;
}> {
  const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
  if (!skill) throw new Error("Skill not found");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, skill.orgId))
    .limit(1);
  if (!org) throw new Error("Org not found");

  const [version] = await db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, versionId))
    .limit(1);
  if (!version || version.skillId !== skillId) {
    throw new Error("Version not found");
  }

  const paths = await listBundlePaths(env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(env.SKILLS_R2, version.r2Prefix, paths);
  const validation = validateSkillBundle(bundle, skill.repo);
  if (!validation.valid) {
    throw new Error(validation.errors.map((e) => e.message).join("; "));
  }

  const review = reviewSkillBundle(bundle, skill.repo, org.reviewRubric);
  const impactScore = estimateImpactScore(review);
  const security = scanSkillSecurity(bundle);
  const pluginRaw = bundle.get("plugin.json");
  const pluginManifest = pluginRaw ? parsePluginManifest(pluginRaw) : null;
  const compatibleAgents = extractAgentDiscovery(pluginManifest);

  const policy = org.publishPolicy ?? undefined;
  const evalNeeded = Boolean(policy?.requireEval || policy?.minEvalUplift != null);
  const evalStatus = await getVersionEvalStatus(db, versionId);

  if (evalNeeded) {
    if (!evalStatus || evalStatus.status === "failed") {
      const queued = await queueSkillEval(env, db, {
        skillId: skill.id,
        versionId,
        orgSlug: org.slug,
        skillRepo: skill.repo,
      });
      throw new Error(
        queued.created
          ? "Eval queued — publish again when complete"
          : "Eval in progress — publish again when complete",
      );
    }
    if (evalStatus.status === "queued" || evalStatus.status === "running") {
      throw new Error("Eval in progress — publish again when complete");
    }
  }

  const completedEval =
    evalStatus?.status === "completed"
      ? { status: evalStatus.status, uplift: evalStatus.uplift }
      : null;

  const policyCheck = evaluatePublishPolicy(policy, review, security, completedEval);
  if (!policyCheck.allowed) {
    throw new Error(policyCheck.reasons.join("; "));
  }

  return commitPublishedVersion({
    env,
    db,
    skill,
    org,
    version,
    bundle,
    frontmatter: validation.frontmatter,
    review,
    impactScore,
    security,
    pluginManifest,
    compatibleAgents,
    userId,
    actorType,
    action: "skill.published",
    auditMetadata: {
      repo: skill.repo,
      version: version.semver,
      qualityScore: review.score,
      impactScore,
      securityStatus: security.status,
    },
  });
}

export async function rollbackVersion(
  env: Env,
  db: WorkerDb,
  skillId: string,
  versionId: string,
  userId: string | null,
  actorType: "user" | "api_key" = "user",
): Promise<{
  etag: string;
  version: string;
  qualityScore: number;
  impactScore: number;
  securityStatus: string;
}> {
  const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
  if (!skill) throw new Error("Skill not found");
  if (skill.latestPublishedVersionId === versionId) {
    throw new Error("Version is already live");
  }

  const [version] = await db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, versionId))
    .limit(1);
  if (!version || version.skillId !== skillId) {
    throw new Error("Version not found");
  }
  if (version.status !== "published" && version.status !== "archived") {
    throw new Error("Only previously published versions can be rolled back to");
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, skill.orgId))
    .limit(1);
  if (!org) throw new Error("Org not found");

  const paths = await listBundlePaths(env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(env.SKILLS_R2, version.r2Prefix, paths);
  const validation = validateSkillBundle(bundle, skill.repo);
  if (!validation.valid) {
    throw new Error(validation.errors.map((e) => e.message).join("; "));
  }

  const review = reviewSkillBundle(bundle, skill.repo, org.reviewRubric);
  const impactScore = estimateImpactScore(review);
  const security = scanSkillSecurity(bundle);
  const pluginRaw = bundle.get("plugin.json");
  const pluginManifest = pluginRaw ? parsePluginManifest(pluginRaw) : null;
  const compatibleAgents = extractAgentDiscovery(pluginManifest);

  return commitPublishedVersion({
    env,
    db,
    skill,
    org,
    version,
    bundle,
    frontmatter: validation.frontmatter,
    review,
    impactScore,
    security,
    pluginManifest,
    compatibleAgents,
    userId,
    actorType,
    action: "skill.rolled_back",
    auditMetadata: {
      repo: skill.repo,
      version: version.semver,
      versionId: version.id,
    },
  });
}
