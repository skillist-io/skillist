// @ts-nocheck
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  executionPolicySchema,
  installCheckSchema,
  installPolicySchema,
  inventoryScanSchema,
  mcpServerSchema,
  publishPolicySchema,
  requiredSkillSchema,
  reviewRubricSchema,
  runEvalSchema,
  telemetryEventSchema,
} from "@skillist/contracts";
import {
  auditEvents,
  organizations,
  orgMcpServers,
  orgRequiredSkills,
  registryEntries,
  skillEvals,
  skillInventory,
  skillRuns,
  skills,
  skillVersions,
  telemetryEvents,
} from "@skillist/db/schema";
import { scanSkillSecurity } from "@skillist/skill-format";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Env } from "../env";
import { logAudit } from "../lib/audit";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { evaluateInstallPolicy } from "../lib/install-policy";
import { requireOrgAccess } from "../lib/org-access";
import { queueSkillEval } from "../lib/queue-eval";
import { resolveUserId } from "../lib/session";
import { buildDayBuckets, incrementDayBucket, toDaySeries } from "../lib/time-series";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const governanceRoutes = new OpenAPIHono<AppEnv>();

const auditRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/audit",
  tags: ["Governance"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
  },
  responses: { 200: { description: "Audit log" } },
});

governanceRoutes.openapi(auditRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { limit } = c.req.valid("query");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const items = await c.var.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.orgId, orgId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);

  return c.json({ items }, 200);
});

const telemetryIngestRoute = createRoute({
  method: "post",
  path: "/telemetry",
  tags: ["Telemetry"],
  request: {
    body: { content: { "application/json": { schema: telemetryEventSchema } } },
  },
  responses: { 201: { description: "Recorded" } },
});

governanceRoutes.openapi(telemetryIngestRoute, async (c) => {
  const body = c.req.valid("json");
  const userId = await resolveUserId(c);
  const apiKeyId = c.var.auth.apiKeyId ?? null;

  await c.var.db.insert(telemetryEvents).values({
    orgSlug: body.orgSlug,
    skillRepo: body.skillRepo,
    eventType: body.eventType,
    projectHash: body.projectHash ?? null,
    userId,
    apiKeyId,
  });

  const column = body.eventType === "install" ? "installCount" : "activationCount";
  await c.var.db
    .update(registryEntries)
    .set({
      [column]: sql`${registryEntries[column]} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(registryEntries.orgSlug, body.orgSlug), eq(registryEntries.skillRepo, body.skillRepo)),
    );

  return c.json({ ok: true }, 201);
});

const orgTelemetryRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/telemetry",
  tags: ["Governance"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }),
  },
  responses: { 200: { description: "Telemetry summary" } },
});

governanceRoutes.openapi(orgTelemetryRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { days } = c.req.valid("query");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [org] = await c.var.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return c.json({ error: "Not found" }, 404);

  const since = new Date();
  since.setDate(since.getDate() - days);

  const events = await c.var.db
    .select()
    .from(telemetryEvents)
    .where(and(eq(telemetryEvents.orgSlug, org.slug), gte(telemetryEvents.createdAt, since)));

  const registry = await c.var.db
    .select({
      skillRepo: registryEntries.skillRepo,
      installCount: registryEntries.installCount,
      activationCount: registryEntries.activationCount,
    })
    .from(registryEntries)
    .where(eq(registryEntries.orgSlug, org.slug));

  return c.json(
    {
      events: events.length,
      installs: events.filter((e) => e.eventType === "install").length,
      activations: events.filter((e) => e.eventType === "activation").length,
      bySkill: registry,
    },
    200,
  );
});

const publishPolicyRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/publish-policy",
  tags: ["Governance"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: publishPolicySchema } } },
  },
  responses: { 200: { description: "Policy updated" } },
});

governanceRoutes.openapi(publishPolicyRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  await c.var.db
    .update(organizations)
    .set({ publishPolicy: body, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "publish_policy.updated",
    resourceType: "organization",
    resourceId: orgId,
    metadata: body,
  });

  return c.json({ ok: true, publishPolicy: body }, 200);
});

const getPublishPolicyRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/publish-policy",
  tags: ["Governance"],
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: { 200: { description: "Publish policy" } },
});

governanceRoutes.openapi(getPublishPolicyRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [org] = await c.var.db
    .select({ publishPolicy: organizations.publishPolicy })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  return c.json({ publishPolicy: org?.publishPolicy ?? {} }, 200);
});

const patchInstallPolicyRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/install-policy",
  tags: ["Governance"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: installPolicySchema } } },
  },
  responses: { 200: { description: "Install policy updated" } },
});

governanceRoutes.openapi(patchInstallPolicyRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  await c.var.db
    .update(organizations)
    .set({ installPolicy: body, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "install_policy.updated",
    resourceType: "organization",
    resourceId: orgId,
    metadata: body,
  });

  return c.json({ ok: true, installPolicy: body }, 200);
});

const getInstallPolicyRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/install-policy",
  tags: ["Governance"],
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: { 200: { description: "Install policy" } },
});

governanceRoutes.openapi(getInstallPolicyRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [org] = await c.var.db
    .select({ installPolicy: organizations.installPolicy, slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  return c.json({ installPolicy: org?.installPolicy ?? {}, orgSlug: org?.slug }, 200);
});

const installCheckRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/install-check",
  tags: ["Governance"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: installCheckSchema } } },
  },
  responses: { 200: { description: "Install policy evaluation" } },
});

governanceRoutes.openapi(installCheckRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [org] = await c.var.db
    .select({
      installPolicy: organizations.installPolicy,
      slug: organizations.slug,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  const [entry] = await c.var.db
    .select({
      securityStatus: registryEntries.securityStatus,
      skillId: registryEntries.skillId,
      updatedAt: registryEntries.updatedAt,
      latestPublishedVersionId: skills.latestPublishedVersionId,
    })
    .from(registryEntries)
    .innerJoin(skills, eq(skills.id, registryEntries.skillId))
    .where(
      and(eq(registryEntries.orgSlug, body.orgSlug), eq(registryEntries.skillRepo, body.skillRepo)),
    )
    .limit(1);

  let securityIssues: { severity: string; path: string; message: string }[] | undefined;
  if (entry?.latestPublishedVersionId) {
    const [version] = await c.var.db
      .select({ securityIssues: skillVersions.securityIssues })
      .from(skillVersions)
      .where(eq(skillVersions.id, entry.latestPublishedVersionId))
      .limit(1);
    securityIssues = version?.securityIssues ?? undefined;
  }

  const result = evaluateInstallPolicy(org?.installPolicy, {
    skillOrgSlug: body.orgSlug,
    policyOrgSlug: org?.slug ?? "",
    source: body.source,
    gitHost: body.gitHost,
    publishedAt: body.publishedAt ? new Date(body.publishedAt) : (entry?.updatedAt ?? null),
    securityStatus: entry?.securityStatus,
    securityIssues,
  });

  return c.json({ ...result, securityStatus: entry?.securityStatus ?? null }, 200);
});

const patchReviewRubricRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/review-rubric",
  tags: ["Governance"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: reviewRubricSchema } } },
  },
  responses: { 200: { description: "Review rubric updated" } },
});

governanceRoutes.openapi(patchReviewRubricRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  await c.var.db
    .update(organizations)
    .set({ reviewRubric: body, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "review_rubric.updated",
    resourceType: "organization",
    resourceId: orgId,
    metadata: body,
  });

  return c.json({ ok: true, reviewRubric: body }, 200);
});

const getReviewRubricRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/review-rubric",
  tags: ["Governance"],
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: { 200: { description: "Review rubric" } },
});

governanceRoutes.openapi(getReviewRubricRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [org] = await c.var.db
    .select({ reviewRubric: organizations.reviewRubric })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  return c.json({ reviewRubric: org?.reviewRubric ?? {} }, 200);
});

const patchExecutionPolicyRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/execution-policy",
  tags: ["Governance"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: executionPolicySchema } } },
  },
  responses: { 200: { description: "Execution policy updated" } },
});

governanceRoutes.openapi(patchExecutionPolicyRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  await c.var.db
    .update(organizations)
    .set({ executionPolicy: body, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "execution_policy.updated",
    resourceType: "organization",
    resourceId: orgId,
    metadata: body,
  });

  return c.json({ ok: true, executionPolicy: body }, 200);
});

const getExecutionPolicyRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/execution-policy",
  tags: ["Governance"],
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: { 200: { description: "Execution policy" } },
});

governanceRoutes.openapi(getExecutionPolicyRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [org] = await c.var.db
    .select({ executionPolicy: organizations.executionPolicy })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  return c.json({ executionPolicy: org?.executionPolicy ?? {} }, 200);
});

const listRequiredSkillsRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/required-skills",
  tags: ["Governance"],
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: { 200: { description: "Required skills" } },
});

governanceRoutes.openapi(listRequiredSkillsRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const items = await c.var.db
    .select()
    .from(orgRequiredSkills)
    .where(eq(orgRequiredSkills.orgId, orgId));

  return c.json({ items }, 200);
});

const addRequiredSkillRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/required-skills",
  tags: ["Governance"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: requiredSkillSchema } } },
  },
  responses: { 201: { description: "Added" } },
});

governanceRoutes.openapi(addRequiredSkillRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [row] = await c.var.db
    .insert(orgRequiredSkills)
    .values({
      orgId,
      orgSlug: body.orgSlug,
      skillRepo: body.skillRepo,
    })
    .onConflictDoNothing()
    .returning();

  return c.json({ item: row ?? null }, 201);
});

const removeRequiredSkillRoute = createRoute({
  method: "delete",
  path: "/orgs/{orgId}/required-skills/{id}",
  tags: ["Governance"],
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      id: z.string().uuid(),
    }),
  },
  responses: { 200: { description: "Removed" } },
});

governanceRoutes.openapi(removeRequiredSkillRoute, async (c) => {
  const { orgId, id } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  await c.var.db
    .delete(orgRequiredSkills)
    .where(and(eq(orgRequiredSkills.id, id), eq(orgRequiredSkills.orgId, orgId)));

  return c.json({ ok: true }, 200);
});

const runEvalRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/skills/{repo}/versions/{versionId}/eval",
  tags: ["Evals"],
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      repo: z.string(),
      versionId: z.string().uuid(),
    }),
    body: {
      content: { "application/json": { schema: runEvalSchema.optional() } },
    },
  },
  responses: { 201: { description: "Eval queued" } },
});

governanceRoutes.openapi(runEvalRoute, async (c) => {
  const { orgId, repo, versionId } = c.req.valid("param");
  const body = c.req.valid("json") ?? {};
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "publisher");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const [version] = await c.var.db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, versionId))
    .limit(1);
  if (!version || version.skillId !== skill.id) {
    return c.json({ error: "Version not found" }, 404);
  }

  const [org] = await c.var.db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  const queued = await queueSkillEval(c.env, c.var.db, {
    skillId: skill.id,
    versionId,
    orgSlug: org?.slug ?? orgId,
    skillRepo: repo,
    scenarios: body.scenarios ?? null,
  });

  const [evalRow] = await c.var.db
    .select()
    .from(skillEvals)
    .where(eq(skillEvals.id, queued.evalId))
    .limit(1);

  return c.json({ eval: evalRow }, queued.created ? 201 : 200);
});

const listEvalsRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/skills/{repo}/evals",
  tags: ["Evals"],
  request: {
    params: z.object({ orgId: z.string().uuid(), repo: z.string() }),
  },
  responses: { 200: { description: "Eval history" } },
});

governanceRoutes.openapi(listEvalsRoute, async (c) => {
  const { orgId, repo } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const items = await c.var.db
    .select({
      id: skillEvals.id,
      versionId: skillEvals.versionId,
      status: skillEvals.status,
      scenarios: skillEvals.scenarios,
      baselineScore: skillEvals.baselineScore,
      withSkillScore: skillEvals.withSkillScore,
      uplift: skillEvals.uplift,
      results: skillEvals.results,
      error: skillEvals.error,
      createdAt: skillEvals.createdAt,
      completedAt: skillEvals.completedAt,
      semver: skillVersions.semver,
      versionStatus: skillVersions.status,
    })
    .from(skillEvals)
    .innerJoin(skillVersions, eq(skillEvals.versionId, skillVersions.id))
    .where(eq(skillEvals.skillId, skill.id))
    .orderBy(desc(skillEvals.createdAt))
    .limit(20);

  return c.json({ items }, 200);
});

const getEvalRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/skills/{repo}/evals/{evalId}",
  tags: ["Evals"],
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      repo: z.string(),
      evalId: z.string().uuid(),
    }),
  },
  responses: { 200: { description: "Eval detail" } },
});

governanceRoutes.openapi(getEvalRoute, async (c) => {
  const { orgId, repo, evalId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const [evalRow] = await c.var.db
    .select()
    .from(skillEvals)
    .where(and(eq(skillEvals.id, evalId), eq(skillEvals.skillId, skill.id)))
    .limit(1);
  if (!evalRow) return c.json({ error: "Not found" }, 404);

  return c.json({ eval: evalRow }, 200);
});

const observabilityRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/observability",
  tags: ["Governance"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }),
  },
  responses: { 200: { description: "Org observability" } },
});

governanceRoutes.openapi(observabilityRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { days } = c.req.valid("query");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [org] = await c.var.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return c.json({ error: "Not found" }, 404);

  const since = new Date();
  since.setDate(since.getDate() - days);

  const events = await c.var.db
    .select()
    .from(telemetryEvents)
    .where(and(eq(telemetryEvents.orgSlug, org.slug), gte(telemetryEvents.createdAt, since)));

  const registry = await c.var.db
    .select({
      skillRepo: registryEntries.skillRepo,
      installCount: registryEntries.installCount,
      activationCount: registryEntries.activationCount,
    })
    .from(registryEntries)
    .where(eq(registryEntries.orgSlug, org.slug));

  const runs = await c.var.db
    .select()
    .from(skillRuns)
    .where(and(eq(skillRuns.orgSlug, org.slug), gte(skillRuns.createdAt, since)))
    .orderBy(desc(skillRuns.createdAt));

  const runBuckets = buildDayBuckets(days);
  const successBuckets = buildDayBuckets(days);
  const installBuckets = buildDayBuckets(days);
  const activationBuckets = buildDayBuckets(days);

  for (const run of runs) {
    incrementDayBucket(runBuckets, run.createdAt);
    if (run.exitCode === 0) {
      incrementDayBucket(successBuckets, run.createdAt);
    }
  }

  for (const event of events) {
    if (event.eventType === "install") {
      incrementDayBucket(installBuckets, event.createdAt);
    } else if (event.eventType === "activation") {
      incrementDayBucket(activationBuckets, event.createdAt);
    }
  }

  const recentRuns = runs.slice(0, 20);
  const finished = runs.filter((r) => r.status === "completed" || r.status === "failed");
  const succeeded = finished.filter((r) => r.exitCode === 0);
  const durations = finished.map((r) => r.durationMs ?? 0).filter((ms) => ms > 0);
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length)
    : 0;

  const byRuntime = runs.reduce<Record<string, number>>((acc, run) => {
    acc[run.runtime] = (acc[run.runtime] ?? 0) + 1;
    return acc;
  }, {});

  return c.json(
    {
      telemetry: {
        events: events.length,
        installs: events.filter((e) => e.eventType === "install").length,
        activations: events.filter((e) => e.eventType === "activation").length,
        bySkill: registry,
      },
      runs: {
        total: runs.length,
        finished: finished.length,
        succeeded: succeeded.length,
        failed: finished.length - succeeded.length,
        successRate:
          finished.length > 0 ? Math.round((succeeded.length / finished.length) * 100) : null,
        avgDurationMs,
        byRuntime,
        recent: recentRuns,
      },
      series: {
        runs: toDaySeries(runBuckets),
        successes: toDaySeries(successBuckets),
        installs: toDaySeries(installBuckets),
        activations: toDaySeries(activationBuckets),
      },
    },
    200,
  );
});

const inventoryScanRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/inventory/scan",
  tags: ["Inventory"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: inventoryScanSchema } } },
  },
  responses: { 200: { description: "Inventory updated" } },
});

governanceRoutes.openapi(inventoryScanRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "publisher");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const { resolveGithubToRegistry } = await import("../lib/github-registry-map");

  const scannedRepos = [...new Set(body.items.map((i) => i.repoFullName))];
  const previous =
    scannedRepos.length > 0
      ? await c.var.db
          .select({
            repoFullName: skillInventory.repoFullName,
            filePath: skillInventory.filePath,
          })
          .from(skillInventory)
          .where(
            and(
              eq(skillInventory.orgId, orgId),
              inArray(skillInventory.repoFullName, scannedRepos),
            ),
          )
      : [];
  const previousKeys = new Set(previous.map((p) => `${p.repoFullName}\0${p.filePath}`));
  const seenKeys = new Set<string>();

  let upserted = 0;
  let created = 0;
  let updated = 0;
  for (const item of body.items) {
    const key = `${item.repoFullName}\0${item.filePath}`;
    seenKeys.add(key);
    const isNew = !previousKeys.has(key);
    if (isNew) created++;
    else updated++;

    const resolved = await resolveGithubToRegistry(c.var.db, {
      repoFullName: item.repoFullName,
      localSlug: item.localSlug,
      registryOrgSlug: item.registryOrgSlug,
      registryRepo: item.registryRepo,
    });
    const registryOrgSlug = resolved?.registryOrgSlug ?? item.registryOrgSlug ?? null;
    const registryRepo = resolved?.registryRepo ?? item.registryRepo ?? null;

    let securityStatus = item.securityStatus ?? null;
    let securityIssues = item.securityIssues ?? null;
    if (item.skillMd && !securityStatus) {
      const scan = scanSkillSecurity(new Map([["SKILL.md", item.skillMd]]));
      securityStatus = scan.status;
      securityIssues = scan.issues;
    }

    await c.var.db
      .insert(skillInventory)
      .values({
        orgId,
        repoFullName: item.repoFullName,
        filePath: item.filePath,
        localSlug: item.localSlug ?? null,
        managed: Boolean(registryOrgSlug && registryRepo),
        registryOrgSlug,
        registryRepo,
        sourceType: item.sourceType ?? null,
        scope: item.scope ?? null,
        marketplace: item.marketplace ?? null,
        pluginName: item.pluginName ?? null,
        isSymlink: item.isSymlink ?? false,
        conformanceStatus: item.conformanceStatus ?? null,
        conformanceIssues: item.conformanceIssues ?? null,
        contentHash: item.contentHash ?? null,
        securityStatus,
        securityIssues,
        scannedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [skillInventory.orgId, skillInventory.repoFullName, skillInventory.filePath],
        set: {
          localSlug: item.localSlug ?? null,
          managed: Boolean(registryOrgSlug && registryRepo),
          registryOrgSlug,
          registryRepo,
          sourceType: item.sourceType ?? null,
          scope: item.scope ?? null,
          marketplace: item.marketplace ?? null,
          pluginName: item.pluginName ?? null,
          isSymlink: item.isSymlink ?? false,
          conformanceStatus: item.conformanceStatus ?? null,
          conformanceIssues: item.conformanceIssues ?? null,
          contentHash: item.contentHash ?? null,
          securityStatus,
          securityIssues,
          scannedAt: new Date(),
        },
      });
    upserted++;
  }

  const removed = previous.filter((p) => !seenKeys.has(`${p.repoFullName}\0${p.filePath}`)).length;

  // Near-duplicate groups by localSlug / contentHash
  const allItems = await c.var.db
    .select({
      localSlug: skillInventory.localSlug,
      contentHash: skillInventory.contentHash,
      filePath: skillInventory.filePath,
      repoFullName: skillInventory.repoFullName,
    })
    .from(skillInventory)
    .where(eq(skillInventory.orgId, orgId));
  const bySlug = new Map<string, number>();
  const byHash = new Map<string, number>();
  for (const row of allItems) {
    if (row.localSlug) bySlug.set(row.localSlug, (bySlug.get(row.localSlug) ?? 0) + 1);
    if (row.contentHash) byHash.set(row.contentHash, (byHash.get(row.contentHash) ?? 0) + 1);
  }
  const duplicateSlugs = [...bySlug.entries()].filter(([, n]) => n > 1).map(([slug]) => slug);
  const duplicateHashes = [...byHash.entries()].filter(([, n]) => n > 1).map(([hash]) => hash);

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "inventory.scanned",
    resourceType: "organization",
    resourceId: orgId,
    metadata: { count: upserted, created, updated, removed },
  });

  return c.json(
    {
      upserted,
      diff: { created, updated, removed },
      duplicates: { slugs: duplicateSlugs, contentHashes: duplicateHashes },
    },
    200,
  );
});

const listInventoryRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/inventory",
  tags: ["Inventory"],
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: { 200: { description: "Skill inventory" } },
});

governanceRoutes.openapi(listInventoryRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const items = await c.var.db
    .select()
    .from(skillInventory)
    .where(eq(skillInventory.orgId, orgId))
    .orderBy(desc(skillInventory.scannedAt));

  const bySlug = new Map<string, typeof items>();
  const byHash = new Map<string, typeof items>();
  for (const item of items) {
    if (item.localSlug) {
      const list = bySlug.get(item.localSlug) ?? [];
      list.push(item);
      bySlug.set(item.localSlug, list);
    }
    if (item.contentHash) {
      const list = byHash.get(item.contentHash) ?? [];
      list.push(item);
      byHash.set(item.contentHash, list);
    }
  }

  return c.json(
    {
      items,
      duplicates: {
        slugs: [...bySlug.entries()]
          .filter(([, rows]) => rows.length > 1)
          .map(([slug, rows]) => ({ slug, count: rows.length })),
        contentHashes: [...byHash.entries()]
          .filter(([, rows]) => rows.length > 1)
          .map(([hash, rows]) => ({ hash, count: rows.length })),
      },
    },
    200,
  );
});

const listMcpServersRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/mcp-servers",
  tags: ["MCP Gateway"],
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: { 200: { description: "Org MCP gateway servers" } },
});

governanceRoutes.openapi(listMcpServersRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const items = await c.var.db
    .select({
      id: orgMcpServers.id,
      name: orgMcpServers.name,
      upstreamUrl: orgMcpServers.upstreamUrl,
      transport: orgMcpServers.transport,
      status: orgMcpServers.status,
      createdAt: orgMcpServers.createdAt,
    })
    .from(orgMcpServers)
    .where(eq(orgMcpServers.orgId, orgId));

  return c.json({ items }, 200);
});

const createMcpServerRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/mcp-servers",
  tags: ["MCP Gateway"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: mcpServerSchema } } },
  },
  responses: { 201: { description: "MCP server registered" } },
});

governanceRoutes.openapi(createMcpServerRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [row] = await c.var.db
    .insert(orgMcpServers)
    .values({
      orgId,
      name: body.name,
      upstreamUrl: body.upstreamUrl,
      transport: body.transport,
      oauthClientId: body.oauthClientId ?? null,
      oauthClientSecret: body.oauthClientSecret ?? null,
      oauthScope: body.oauthScope ?? null,
      oauthResourceUrl: body.oauthResourceUrl ?? null,
      oauthAuthorizationServerUrl: body.oauthAuthorizationServerUrl ?? null,
      status: "unauthorized",
    })
    .returning({
      id: orgMcpServers.id,
      name: orgMcpServers.name,
      upstreamUrl: orgMcpServers.upstreamUrl,
      transport: orgMcpServers.transport,
      status: orgMcpServers.status,
    });

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "mcp_server.created",
    resourceType: "mcp_server",
    resourceId: row?.id ?? null,
    metadata: { name: body.name },
  });

  return c.json(row, 201);
});

const authorizeMcpServerRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/mcp-servers/{name}/authorize",
  tags: ["MCP Gateway"],
  request: {
    params: z.object({ orgId: z.string().uuid(), name: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            accessToken: z.string().min(1),
            refreshToken: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: { 200: { description: "MCP server authorized" } },
});

governanceRoutes.openapi(authorizeMcpServerRoute, async (c) => {
  const { orgId, name } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [row] = await c.var.db
    .update(orgMcpServers)
    .set({
      accessToken: body.accessToken,
      refreshToken: body.refreshToken ?? null,
      status: "authorized",
      updatedAt: new Date(),
    })
    .where(and(eq(orgMcpServers.orgId, orgId), eq(orgMcpServers.name, name)))
    .returning({ id: orgMcpServers.id, name: orgMcpServers.name, status: orgMcpServers.status });

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row, 200);
});

const getMcpProxyConfigRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/mcp-servers/{name}/proxy",
  tags: ["MCP Gateway"],
  request: { params: z.object({ orgId: z.string().uuid(), name: z.string() }) },
  responses: { 200: { description: "MCP proxy connection config" } },
});

governanceRoutes.openapi(getMcpProxyConfigRoute, async (c) => {
  const { orgId, name } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [row] = await c.var.db
    .select()
    .from(orgMcpServers)
    .where(and(eq(orgMcpServers.orgId, orgId), eq(orgMcpServers.name, name)))
    .limit(1);

  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.status !== "authorized" || !row.accessToken) {
    return c.json({ error: "MCP server is not authorized" }, 409);
  }

  return c.json(
    {
      name: row.name,
      upstreamUrl: row.upstreamUrl,
      transport: row.transport,
      accessToken: row.accessToken,
      orgSlug: (
        await c.var.db
          .select({ slug: organizations.slug })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1)
      )[0]?.slug,
    },
    200,
  );
});

const promoteInventoryRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/inventory/{itemId}/promote",
  tags: ["Inventory"],
  request: {
    params: z.object({ orgId: z.string().uuid(), itemId: z.string().uuid() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            repo: z
              .string()
              .min(1)
              .max(64)
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
              .optional(),
          }),
        },
      },
    },
  },
  responses: { 201: { description: "Skill created from inventory item" } },
});

governanceRoutes.openapi(promoteInventoryRoute, async (c) => {
  const { orgId, itemId } = c.req.valid("param");
  const body = c.req.valid("json") ?? {};
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "publisher");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [item] = await c.var.db
    .select()
    .from(skillInventory)
    .where(and(eq(skillInventory.id, itemId), eq(skillInventory.orgId, orgId)))
    .limit(1);
  if (!item) return c.json({ error: "Not found" }, 404);

  const repo =
    body.repo ??
    item.localSlug ??
    item.filePath.split("/").filter(Boolean).at(-2) ??
    "imported-skill";

  const [existing] = await c.var.db
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (existing) {
    return c.json({ error: `Skill ${repo} already exists`, skillId: existing.id }, 409);
  }

  const [skill] = await c.var.db
    .insert(skills)
    .values({
      orgId,
      repo,
      visibility: "private",
      description: `Promoted from inventory ${item.repoFullName}:${item.filePath}`,
    })
    .returning();

  await c.var.db
    .update(skillInventory)
    .set({
      managed: true,
      registryOrgSlug:
        (
          await c.var.db
            .select({ slug: organizations.slug })
            .from(organizations)
            .where(eq(organizations.id, orgId))
            .limit(1)
        )[0]?.slug ?? null,
      registryRepo: repo,
    })
    .where(eq(skillInventory.id, itemId));

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "inventory.promoted",
    resourceType: "skill",
    resourceId: skill?.id ?? null,
    metadata: { itemId, repo, from: item.repoFullName },
  });

  return c.json({ skill }, 201);
});

const requiredSkillsCheckRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/required-skills/check",
  tags: ["Governance"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({
      installed: z.string().optional().describe("Comma-separated org/repo refs"),
    }),
  },
  responses: { 200: { description: "Required skills compliance" } },
});

governanceRoutes.openapi(requiredSkillsCheckRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { installed } = c.req.valid("query");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const required = await c.var.db
    .select()
    .from(orgRequiredSkills)
    .where(eq(orgRequiredSkills.orgId, orgId));

  const installedSet = new Set(
    (installed ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const missing = required
    .filter((r) => !installedSet.has(`${r.orgSlug}/${r.skillRepo}`))
    .map((r) => `${r.orgSlug}/${r.skillRepo}`);

  return c.json(
    {
      required: required.map((r) => `${r.orgSlug}/${r.skillRepo}`),
      installed: [...installedSet],
      missing,
      compliant: missing.length === 0,
    },
    200,
  );
});

const requiredSkillsWorkflowRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/required-skills/workflow",
  tags: ["Governance"],
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: { 200: { description: "Suggested GitHub Actions workflow for required skills" } },
});

governanceRoutes.openapi(requiredSkillsWorkflowRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [org] = await c.var.db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const required = await c.var.db
    .select()
    .from(orgRequiredSkills)
    .where(eq(orgRequiredSkills.orgId, orgId));

  const installs = required
    .map((r) => `        skillist install ${r.orgSlug}/${r.skillRepo}`)
    .join("\n");

  const yaml = `name: skillist-required-skills
on:
  pull_request:
  workflow_dispatch:
jobs:
  enforce:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm install -g @skillist/cli
      - name: Install required skills
        env:
          SKILLIST_API_KEY: \${{ secrets.SKILLIST_API_KEY }}
        run: |
${installs || "        echo 'No required skills configured'"}
      - name: Verify required skills
        env:
          SKILLIST_API_KEY: \${{ secrets.SKILLIST_API_KEY }}
        run: skillist required-skills check --org ${org?.slug ?? "ORG_SLUG"}
`;

  return c.json({ orgSlug: org?.slug, requiredCount: required.length, workflow: yaml }, 200);
});
