import type { Env } from "../env";
import type { WorkerDb } from "./db";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  feedback,
  skillFiles,
  skillVersions,
  skills,
} from "@skillist/db/schema";
import {
  objectToBundle,
  validateSkillBundle,
  reviewSkillBundle,
  estimateImpactScore,
  scanSkillSecurity,
  parsePluginManifest,
  extractRegistryDiscovery,
  extractAgentDiscovery,
} from "@skillist/skill-format";
import {
  downloadBundleFromR2,
  listBundlePaths,
  r2Prefix,
  sha256,
  uploadBundleToR2,
} from "./r2";
import { cachePublishedSkill, broadcastPublish } from "./publish";
import { organizations, skillEvals } from "@skillist/db/schema";
import { evaluatePublishPolicy } from "./publish-policy";
import { logAudit } from "./audit";
import { detectSkillRuntime } from "./skill-runtime";

export async function runAiJob(
  env: Env,
  db: WorkerDb,
  jobId: string,
  feedbackId: string,
): Promise<void> {
  const [job] = await db
    .select()
    .from(feedback)
    .where(eq(feedback.id, feedbackId))
    .limit(1);
  if (!job) return;

  const [skill] = await db
    .select()
    .from(skills)
    .where(eq(skills.id, job.skillId))
    .limit(1);
  if (!skill) return;

  const [version] = await db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, job.targetVersionId))
    .limit(1);
  if (!version) return;

  const paths = await listBundlePaths(env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(
    env.SKILLS_R2,
    version.r2Prefix,
    paths,
  );
  const skillMd = bundle.get("SKILL.md") ?? "";

  const prompt = `You are improving an Agent Skill per agentskills.io spec.
Current SKILL.md:
${skillMd}

Feedback:
${job.body}

Return ONLY the complete improved SKILL.md file with valid YAML frontmatter.`;

  let improvedMd: string;
  try {
    if (env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_TOKEN) {
      const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/skillist/workers-ai/@cf/meta/llama-3.1-8b-instruct`;
      const res = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.AI_GATEWAY_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
      });
      const data = (await res.json()) as { result?: { response?: string } };
      improvedMd = data.result?.response ?? skillMd;
    } else {
      const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "user", content: prompt }],
      });
      improvedMd =
        (result as { response?: string }).response ?? skillMd;
    }
  } catch (err) {
    await db
      .update(feedback)
      .set({ status: "pending" })
      .where(eq(feedback.id, feedbackId));
    throw err;
  }

  const newBundle = new Map(bundle);
  newBundle.set("SKILL.md", improvedMd);
  const validation = validateSkillBundle(newBundle, skill.slug);
  if (!validation.valid) {
    throw new Error("AI output failed validation");
  }

  const versionId = crypto.randomUUID();
  const prefix = r2Prefix(skill.orgId, skill.slug, versionId);
  await uploadBundleToR2(env.SKILLS_R2, prefix, newBundle);

  const fileEntries = [...newBundle.entries()];
  await db.insert(skillVersions).values({
    id: versionId,
    skillId: skill.id,
    status: "draft",
    semver: bumpPatch(version.semver),
    r2Prefix: prefix,
    parentVersionId: version.id,
    createdBy: job.submittedBy,
  });

  for (const [path, content] of fileEntries) {
    await db.insert(skillFiles).values({
      versionId,
      path,
      sha256: await sha256(content),
      size: content.length,
    });
  }

  const { aiJobs } = await import("@skillist/db/schema");
  await db
    .update(aiJobs)
    .set({
      status: "completed",
      resultDraftVersionId: versionId,
      completedAt: new Date(),
    })
    .where(eq(aiJobs.id, jobId));
}

function bumpPatch(semver: string): string {
  const parts = semver.split(".").map(Number);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join(".");
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
  const [skill] = await db
    .select()
    .from(skills)
    .where(eq(skills.id, skillId))
    .limit(1);
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
  const bundle = await downloadBundleFromR2(
    env.SKILLS_R2,
    version.r2Prefix,
    paths,
  );
  const validation = validateSkillBundle(bundle, skill.slug);
  if (!validation.valid) {
    throw new Error(
      validation.errors.map((e) => e.message).join("; "),
    );
  }

  const review = reviewSkillBundle(bundle, skill.slug);
  const impactScore = estimateImpactScore(review);
  const security = scanSkillSecurity(bundle);
  const pluginRaw = bundle.get("plugin.json");
  const pluginManifest = pluginRaw ? parsePluginManifest(pluginRaw) : null;
  const compatibleAgents = extractAgentDiscovery(pluginManifest);

  const [latestEval] = await db
    .select({
      status: skillEvals.status,
      uplift: skillEvals.uplift,
    })
    .from(skillEvals)
    .where(
      and(
        eq(skillEvals.versionId, versionId),
        eq(skillEvals.status, "completed"),
      ),
    )
    .orderBy(desc(skillEvals.completedAt))
    .limit(1);

  const policyCheck = evaluatePublishPolicy(
    org.publishPolicy ?? undefined,
    review,
    security,
    latestEval ?? null,
  );
  if (!policyCheck.allowed) {
    throw new Error(policyCheck.reasons.join("; "));
  }

  const reviewChecks = review.checks.map(({ id, label, passed, message }) => ({
    id,
    label,
    passed,
    message,
  }));

  const skillMd = bundle.get("SKILL.md")!;
  const etag = (await sha256(skillMd)).slice(0, 16);
  const publishedAt = new Date().toISOString();

  await cachePublishedSkill(env.SKILLS_KV, org.slug, skill.slug, {
    skillMd,
    meta: {
      name: validation.frontmatter.name,
      description: validation.frontmatter.description,
      version: version.semver,
      versionId: version.id,
      etag,
      org: org.slug,
      slug: skill.slug,
      publishedAt,
    },
  });

  await db
    .update(skillVersions)
    .set({ status: "archived" })
    .where(
      and(
        eq(skillVersions.skillId, skillId),
        eq(skillVersions.status, "published"),
        ne(skillVersions.id, versionId),
      ),
    );

  await db
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
    .where(eq(skillVersions.id, versionId));

  await db
    .update(skills)
    .set({
      latestPublishedVersionId: versionId,
      description: validation.frontmatter.description,
      runtime: detectSkillRuntime(bundle),
      updatedAt: new Date(),
    })
    .where(eq(skills.id, skillId));

  if (skill.visibility === "public") {
    const { registryEntries } = await import("@skillist/db/schema");
    const discovery = extractRegistryDiscovery(validation.frontmatter);
    await db
      .insert(registryEntries)
      .values({
        skillId: skill.id,
        orgSlug: org.slug,
        skillSlug: skill.slug,
        name: validation.frontmatter.name,
        description: validation.frontmatter.description,
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
          name: validation.frontmatter.name,
          description: validation.frontmatter.description,
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

  const [evalRow] = await db
    .insert(skillEvals)
    .values({
      skillId: skill.id,
      versionId: version.id,
      status: "queued",
    })
    .returning();

  if (evalRow) {
    await env.AI_QUEUE.send({
      type: "eval",
      evalId: evalRow.id,
      skillId: skill.id,
      versionId: version.id,
      orgSlug: org.slug,
      skillSlug: skill.slug,
    });
  }

  await logAudit(db, {
    orgId: org.id,
    actorId: userId,
    actorType,
    action: "skill.published",
    resourceType: "skill",
    resourceId: skill.id,
    metadata: {
      slug: skill.slug,
      version: version.semver,
      qualityScore: review.score,
      impactScore,
      securityStatus: security.status,
    },
  });

  const event = {
    type: "skill.published" as const,
    org: org.slug,
    slug: skill.slug,
    version: version.semver,
    versionId: version.id,
    etag,
    publishedAt,
    skillMd: skillMd.length < 65536 ? skillMd : undefined,
  };

  await broadcastPublish(env, org.slug, skill.slug, event);

  return {
    etag,
    version: version.semver,
    qualityScore: review.score,
    impactScore,
    securityStatus: security.status,
  };
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
  const [skill] = await db
    .select()
    .from(skills)
    .where(eq(skills.id, skillId))
    .limit(1);
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
  const bundle = await downloadBundleFromR2(
    env.SKILLS_R2,
    version.r2Prefix,
    paths,
  );
  const validation = validateSkillBundle(bundle, skill.slug);
  if (!validation.valid) {
    throw new Error(validation.errors.map((e) => e.message).join("; "));
  }

  const review = reviewSkillBundle(bundle, skill.slug);
  const impactScore = estimateImpactScore(review);
  const security = scanSkillSecurity(bundle);
  const pluginRaw = bundle.get("plugin.json");
  const pluginManifest = pluginRaw ? parsePluginManifest(pluginRaw) : null;
  const compatibleAgents = extractAgentDiscovery(pluginManifest);

  const reviewChecks = review.checks.map(({ id, label, passed, message }) => ({
    id,
    label,
    passed,
    message,
  }));

  const skillMd = bundle.get("SKILL.md")!;
  const etag = (await sha256(skillMd)).slice(0, 16);
  const publishedAt = new Date().toISOString();

  await cachePublishedSkill(env.SKILLS_KV, org.slug, skill.slug, {
    skillMd,
    meta: {
      name: validation.frontmatter.name,
      description: validation.frontmatter.description,
      version: version.semver,
      versionId: version.id,
      etag,
      org: org.slug,
      slug: skill.slug,
      publishedAt,
    },
  });

  await db
    .update(skillVersions)
    .set({ status: "archived" })
    .where(
      and(
        eq(skillVersions.skillId, skillId),
        eq(skillVersions.status, "published"),
        ne(skillVersions.id, versionId),
      ),
    );

  await db
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
    .where(eq(skillVersions.id, versionId));

  await db
    .update(skills)
    .set({
      latestPublishedVersionId: versionId,
      description: validation.frontmatter.description,
      runtime: detectSkillRuntime(bundle),
      updatedAt: new Date(),
    })
    .where(eq(skills.id, skillId));

  if (skill.visibility === "public") {
    const { registryEntries } = await import("@skillist/db/schema");
    const discovery = extractRegistryDiscovery(validation.frontmatter);
    await db
      .insert(registryEntries)
      .values({
        skillId: skill.id,
        orgSlug: org.slug,
        skillSlug: skill.slug,
        name: validation.frontmatter.name,
        description: validation.frontmatter.description,
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
          name: validation.frontmatter.name,
          description: validation.frontmatter.description,
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

  await logAudit(db, {
    orgId: org.id,
    actorId: userId,
    actorType,
    action: "skill.rolled_back",
    resourceType: "skill",
    resourceId: skill.id,
    metadata: {
      slug: skill.slug,
      version: version.semver,
      versionId: version.id,
    },
  });

  const event = {
    type: "skill.published" as const,
    org: org.slug,
    slug: skill.slug,
    version: version.semver,
    versionId: version.id,
    etag,
    publishedAt,
    skillMd: skillMd.length < 65536 ? skillMd : undefined,
  };

  await broadcastPublish(env, org.slug, skill.slug, event);

  return {
    etag,
    version: version.semver,
    qualityScore: review.score,
    impactScore,
    securityStatus: security.status,
  };
}
