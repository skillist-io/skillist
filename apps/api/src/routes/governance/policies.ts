import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  executionPolicySchema,
  installCheckSchema,
  installPolicySchema,
  publishPolicySchema,
  requiredSkillSchema,
  reviewRubricSchema,
} from "@skillist/contracts";
import {
  organizations,
  orgRequiredSkills,
  registryEntries,
  skills,
  skillVersions,
} from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import { logAudit } from "../../lib/audit";
import { evaluateInstallPolicy } from "../../lib/install-policy";
import { requireOrgAccess } from "../../lib/org-access";
import type { AppEnv } from "./shared";

export const policiesRoutes = new OpenAPIHono<AppEnv>();

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

policiesRoutes.openapi(publishPolicyRoute, async (c) => {
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

policiesRoutes.openapi(getPublishPolicyRoute, async (c) => {
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

policiesRoutes.openapi(patchInstallPolicyRoute, async (c) => {
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

policiesRoutes.openapi(getInstallPolicyRoute, async (c) => {
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

policiesRoutes.openapi(installCheckRoute, async (c) => {
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

policiesRoutes.openapi(patchReviewRubricRoute, async (c) => {
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

policiesRoutes.openapi(getReviewRubricRoute, async (c) => {
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

policiesRoutes.openapi(patchExecutionPolicyRoute, async (c) => {
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

policiesRoutes.openapi(getExecutionPolicyRoute, async (c) => {
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

policiesRoutes.openapi(listRequiredSkillsRoute, async (c) => {
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

policiesRoutes.openapi(addRequiredSkillRoute, async (c) => {
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

policiesRoutes.openapi(removeRequiredSkillRoute, async (c) => {
  const { orgId, id } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  await c.var.db
    .delete(orgRequiredSkills)
    .where(and(eq(orgRequiredSkills.id, id), eq(orgRequiredSkills.orgId, orgId)));

  return c.json({ ok: true }, 200);
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

policiesRoutes.openapi(requiredSkillsCheckRoute, async (c) => {
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

policiesRoutes.openapi(requiredSkillsWorkflowRoute, async (c) => {
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
