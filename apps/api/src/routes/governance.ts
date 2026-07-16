// @ts-nocheck
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  inventoryScanSchema,
  executionPolicySchema,
  publishPolicySchema,
  requiredSkillSchema,
  runEvalSchema,
  telemetryEventSchema,
} from "@skillist/contracts";
import {
  auditEvents,
  orgRequiredSkills,
  organizations,
  registryEntries,
  skillEvals,
  skillInventory,
  skillRuns,
  skills,
  skillVersions,
  telemetryEvents,
} from "@skillist/db/schema";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import { queueSkillEval } from "../lib/queue-eval";
import type { WorkerDb } from "../lib/db";
import { logAudit } from "../lib/audit";
import { requireOrgAccess } from "../lib/org-access";
import { resolveUserId } from "../lib/session";
import {
  buildDayBuckets,
  incrementDayBucket,
  toDaySeries,
} from "../lib/time-series";

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

  const column =
    body.eventType === "install" ? "installCount" : "activationCount";
  await c.var.db
    .update(registryEntries)
    .set({
      [column]: sql`${registryEntries[column]} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(registryEntries.orgSlug, body.orgSlug),
        eq(registryEntries.skillRepo, body.skillRepo),
      ),
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
    .where(
      and(
        eq(telemetryEvents.orgSlug, org.slug),
        gte(telemetryEvents.createdAt, since),
      ),
    );

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
    .where(
      and(eq(orgRequiredSkills.id, id), eq(orgRequiredSkills.orgId, orgId)),
    );

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
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "editor");
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
    .where(
      and(
        eq(telemetryEvents.orgSlug, org.slug),
        gte(telemetryEvents.createdAt, since),
      ),
    );

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
    .where(
      and(
        eq(skillRuns.orgSlug, org.slug),
        gte(skillRuns.createdAt, since),
      ),
    )
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
  const finished = runs.filter(
    (r) => r.status === "completed" || r.status === "failed",
  );
  const succeeded = finished.filter((r) => r.exitCode === 0);
  const durations = finished
    .map((r) => r.durationMs ?? 0)
    .filter((ms) => ms > 0);
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
          finished.length > 0
            ? Math.round((succeeded.length / finished.length) * 100)
            : null,
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
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "editor");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const { resolveGithubToRegistry } = await import("../lib/github-registry-map");

  let upserted = 0;
  for (const item of body.items) {
    const resolved = await resolveGithubToRegistry(c.var.db, {
      repoFullName: item.repoFullName,
      localSlug: item.localSlug,
      registryOrgSlug: item.registryOrgSlug,
      registryRepo: item.registryRepo,
    });
    const registryOrgSlug =
      resolved?.registryOrgSlug ?? item.registryOrgSlug ?? null;
    const registryRepo = resolved?.registryRepo ?? item.registryRepo ?? null;

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
        scannedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          skillInventory.orgId,
          skillInventory.repoFullName,
          skillInventory.filePath,
        ],
        set: {
          localSlug: item.localSlug ?? null,
          managed: Boolean(registryOrgSlug && registryRepo),
          registryOrgSlug,
          registryRepo,
          scannedAt: new Date(),
        },
      });
    upserted++;
  }

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "inventory.scanned",
    resourceType: "organization",
    resourceId: orgId,
    metadata: { count: upserted },
  });

  return c.json({ upserted }, 200);
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

  return c.json({ items }, 200);
});
