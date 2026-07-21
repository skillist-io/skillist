import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { runEvalSchema } from "@skillist/contracts";
import { organizations, skillEvals, skills, skillVersions } from "@skillist/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { errorResponses } from "../../lib/openapi";
import { requireOrgAccess } from "../../lib/org-access";
import { queueSkillEval } from "../../lib/queue-eval";
import type { AppEnv } from "./shared";

export const evalsRoutes = new OpenAPIHono<AppEnv>();

/** A per-scenario eval outcome, as stored in `skill_evals.results`. */
const evalScenarioResultSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  baselineScore: z.number(),
  withSkillScore: z.number(),
  uplift: z.number(),
});

/** A row of `skill_evals`; timestamps serialize to ISO strings. */
const skillEvalRowSchema = z.object({
  id: z.string().uuid(),
  skillId: z.string().uuid(),
  versionId: z.string().uuid(),
  status: z.string(),
  scenarios: z.array(z.object({ name: z.string(), prompt: z.string() })).nullable(),
  baselineScore: z.number().nullable(),
  withSkillScore: z.number().nullable(),
  uplift: z.number().nullable(),
  results: z.array(evalScenarioResultSchema).nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

const runEvalRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/skills/{repo}/versions/{versionId}/eval",
  tags: ["Evals"],
  operationId: "runSkillEval",
  summary: "Queue an eval run for a skill version",
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
  responses: {
    201: {
      content: { "application/json": { schema: z.object({ eval: skillEvalRowSchema }) } },
      description: "Eval queued",
    },
    // The handler returns `queued.created ? 201 : 200`: when an eval for this
    // version is already queued or running it reuses that one and answers 200.
    // Undeclared, a generated client would type this branch as an error.
    200: {
      content: { "application/json": { schema: z.object({ eval: skillEvalRowSchema }) } },
      description: "Eval already queued or running; the existing one is returned",
    },
    ...errorResponses(),
  },
});

evalsRoutes.openapi(runEvalRoute, async (c) => {
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
  operationId: "listSkillEvals",
  summary: "List a skill's eval history",
  request: {
    params: z.object({ orgId: z.string().uuid(), repo: z.string() }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          // The eval row joined to its version's semver/status, minus skillId.
          schema: z.object({
            items: z.array(
              skillEvalRowSchema.omit({ skillId: true }).extend({
                semver: z.string(),
                versionStatus: z.string(),
              }),
            ),
          }),
        },
      },
      description: "Eval history",
    },
    ...errorResponses(),
  },
});

evalsRoutes.openapi(listEvalsRoute, async (c) => {
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
  operationId: "getSkillEval",
  summary: "Get a single eval result",
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      repo: z.string(),
      evalId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ eval: skillEvalRowSchema }) } },
      description: "Eval detail",
    },
    ...errorResponses(),
  },
});

evalsRoutes.openapi(getEvalRoute, async (c) => {
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
