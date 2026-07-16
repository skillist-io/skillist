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
  skills,
  skillVersions,
  telemetryEvents,
} from "@skillist/db/schema";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { logAudit } from "../lib/audit";
import { requireOrgAccess } from "../lib/org-access";
import { resolveUserId } from "../lib/session";

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
    skillSlug: body.skillSlug,
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
        eq(registryEntries.skillSlug, body.skillSlug),
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
      skillSlug: registryEntries.skillSlug,
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
      skillSlug: body.skillSlug,
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
  path: "/orgs/{orgId}/skills/{slug}/versions/{versionId}/eval",
  tags: ["Evals"],
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      slug: z.string(),
      versionId: z.string().uuid(),
    }),
    body: {
      content: { "application/json": { schema: runEvalSchema.optional() } },
    },
  },
  responses: { 201: { description: "Eval queued" } },
});

governanceRoutes.openapi(runEvalRoute, async (c) => {
  const { orgId, slug, versionId } = c.req.valid("param");
  const body = c.req.valid("json") ?? {};
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "editor");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.slug, slug)))
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

  const [evalRow] = await c.var.db
    .insert(skillEvals)
    .values({
      skillId: skill.id,
      versionId,
      scenarios: body.scenarios ?? null,
      status: "queued",
    })
    .returning();

  await c.env.AI_QUEUE.send({
    type: "eval",
    evalId: evalRow!.id,
    skillId: skill.id,
    versionId,
    orgSlug: "",
    skillSlug: slug,
  });

  return c.json({ eval: evalRow }, 201);
});

const listEvalsRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/skills/{slug}/evals",
  tags: ["Evals"],
  request: {
    params: z.object({ orgId: z.string().uuid(), slug: z.string() }),
  },
  responses: { 200: { description: "Eval history" } },
});

governanceRoutes.openapi(listEvalsRoute, async (c) => {
  const { orgId, slug } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.slug, slug)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const items = await c.var.db
    .select()
    .from(skillEvals)
    .where(eq(skillEvals.skillId, skill.id))
    .orderBy(desc(skillEvals.createdAt))
    .limit(20);

  return c.json({ items }, 200);
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

  let upserted = 0;
  for (const item of body.items) {
    await c.var.db
      .insert(skillInventory)
      .values({
        orgId,
        repoFullName: item.repoFullName,
        filePath: item.filePath,
        skillSlug: item.skillSlug ?? null,
        managed: Boolean(item.registryOrgSlug && item.registrySkillSlug),
        registryOrgSlug: item.registryOrgSlug ?? null,
        registrySkillSlug: item.registrySkillSlug ?? null,
        scannedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          skillInventory.orgId,
          skillInventory.repoFullName,
          skillInventory.filePath,
        ],
        set: {
          skillSlug: item.skillSlug ?? null,
          managed: Boolean(item.registryOrgSlug && item.registrySkillSlug),
          registryOrgSlug: item.registryOrgSlug ?? null,
          registrySkillSlug: item.registrySkillSlug ?? null,
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
