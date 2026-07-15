// @ts-nocheck
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq } from "drizzle-orm";
import { runSkillSchema } from "@skillist/contracts";
import { organizations, skillRuns, skills, telemetryEvents } from "@skillist/db/schema";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import {
  getPublishedBundle,
  getRunnableScriptsFromBundle,
  runSkillScript,
} from "../lib/skill-runner";
import { resolveUserId } from "../lib/session";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const executionRoutes = new OpenAPIHono<AppEnv>();

const listScriptsRoute = createRoute({
  method: "get",
  path: "/skills/{org}/{slug}/scripts",
  tags: ["Execution"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
  },
  responses: { 200: { description: "Runnable scripts" } },
});

executionRoutes.openapi(listScriptsRoute, async (c) => {
  const { org, slug } = c.req.valid("param");
  try {
    const { bundle, skill } = await getPublishedBundle(c.env, c.var.db, org, slug);
    return c.json(
      {
        runtime: skill.runtime,
        scripts: getRunnableScriptsFromBundle(bundle),
      },
      200,
    );
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Not found" },
      404,
    );
  }
});

const runScriptRoute = createRoute({
  method: "post",
  path: "/skills/{org}/{slug}/run",
  tags: ["Execution"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
    body: { content: { "application/json": { schema: runSkillSchema } } },
  },
  responses: { 200: { description: "Execution result" } },
});

executionRoutes.openapi(runScriptRoute, async (c) => {
  const { org, slug } = c.req.valid("param");
  const body = c.req.valid("json");

  const [orgRow] = await c.var.db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, org))
    .limit(1);
  if (!orgRow) return c.json({ error: "Not found" }, 404);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgRow.id), eq(skills.slug, slug)))
    .limit(1);
  if (!skill || skill.visibility !== "public") {
    return c.json({ error: "Not found" }, 404);
  }

  const userId = await resolveUserId(c);
  const actorType = c.var.auth.apiKeyId
    ? "api_key"
    : userId
      ? "user"
      : "system";
  const actorId = c.var.auth.apiKeyCreatedBy ?? userId;

  try {
    const result = await runSkillScript(c.env, c.var.db, {
      orgSlug: org,
      skillSlug: slug,
      scriptPath: body.scriptPath,
      args: body.args,
      targetUrl: body.targetUrl,
      actorId,
      actorType,
    });

    await c.var.db.insert(telemetryEvents).values({
      orgSlug: org,
      skillSlug: slug,
      eventType: "activation",
      userId,
      apiKeyId: c.var.auth.apiKeyId,
    });

    return c.json(result, 200);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Execution failed" },
      400,
    );
  }
});

const listRunsRoute = createRoute({
  method: "get",
  path: "/skills/{org}/{slug}/runs",
  tags: ["Execution"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }),
  },
  responses: { 200: { description: "Run history" } },
});

executionRoutes.openapi(listRunsRoute, async (c) => {
  const { org, slug } = c.req.valid("param");
  const { limit } = c.req.valid("query");

  const [orgRow] = await c.var.db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, org))
    .limit(1);
  if (!orgRow) return c.json({ error: "Not found" }, 404);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgRow.id), eq(skills.slug, slug)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const items = await c.var.db
    .select()
    .from(skillRuns)
    .where(eq(skillRuns.skillId, skill.id))
    .orderBy(desc(skillRuns.createdAt))
    .limit(limit);

  return c.json({ items }, 200);
});

const getRunRoute = createRoute({
  method: "get",
  path: "/runs/{id}",
  tags: ["Execution"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "Run detail" } },
});

executionRoutes.openapi(getRunRoute, async (c) => {
  const { id } = c.req.valid("param");
  const [run] = await c.var.db
    .select()
    .from(skillRuns)
    .where(eq(skillRuns.id, id))
    .limit(1);
  if (!run) return c.json({ error: "Not found" }, 404);
  return c.json(run, 200);
});
