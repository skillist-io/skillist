import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { runSkillSchema } from "@skillist/contracts";
import { organizations, skillRuns, skills, telemetryEvents } from "@skillist/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { checkRunQuota } from "../lib/run-quota";
import { assertSkillRunAccess } from "../lib/skill-execution-access";
import {
  getPublishedBundle,
  getRunnableScriptsFromBundle,
  runSkillScript,
} from "../lib/skill-runner";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const executionRoutes = new OpenAPIHono<AppEnv>();

async function loadOrgSkill(db: WorkerDb, orgSlug: string, repo: string) {
  const [orgRow] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, orgSlug))
    .limit(1);
  if (!orgRow) return null;

  const [skill] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgRow.id), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return null;

  return { org: orgRow, skill };
}

const orgRepoParams = z.object({ org: z.string(), repo: z.string() });

const listScriptsRoute = createRoute({
  method: "get",
  path: "/{org}/{repo}/scripts",
  tags: ["Execution"],
  request: { params: orgRepoParams },
  responses: { 200: { description: "Runnable scripts" } },
});

executionRoutes.openapi(listScriptsRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const loaded = await loadOrgSkill(c.var.db, org, repo);
  if (!loaded) return c.json({ error: "Not found" }, 404);

  const access = await assertSkillRunAccess(c.var.db, c.var.auth, loaded.org, loaded.skill, "view");
  if (!access.ok) {
    return c.json({ error: "Not found" }, access.status === 401 ? 401 : 404);
  }

  try {
    const { bundle, skill } = await getPublishedBundle(c.env, c.var.db, org, repo);
    return c.json(
      {
        runtime: skill.runtime,
        scripts: getRunnableScriptsFromBundle(bundle),
      },
      200,
    );
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Not found" }, 404);
  }
});

const runScriptRoute = createRoute({
  method: "post",
  path: "/{org}/{repo}/run",
  tags: ["Execution"],
  request: {
    params: orgRepoParams,
    body: { content: { "application/json": { schema: runSkillSchema } } },
  },
  responses: { 200: { description: "Execution result" } },
});

executionRoutes.openapi(runScriptRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const body = c.req.valid("json");

  const loaded = await loadOrgSkill(c.var.db, org, repo);
  if (!loaded) return c.json({ error: "Not found" }, 404);

  const access = await assertSkillRunAccess(c.var.db, c.var.auth, loaded.org, loaded.skill);
  if (!access.ok) {
    return c.json(
      {
        error: access.status === 401 ? "Authentication required" : "Forbidden",
      },
      access.status,
    );
  }

  if (loaded.skill.runtime === "local") {
    return c.json({ error: "This skill has no hosted runtime" }, 400);
  }

  const quota = await checkRunQuota(
    c.var.db,
    loaded.org.id,
    loaded.org.executionPolicy,
    loaded.skill.runtime,
    access.isAnonymous,
  );
  if (!quota.ok) {
    return c.json({ error: quota.message }, 429);
  }

  const runInput = {
    orgSlug: org,
    skillRepo: repo,
    scriptPath: body.scriptPath,
    args: body.args,
    targetUrl: body.targetUrl,
    actorId: access.actorId,
    actorType: access.actorType,
  };

  const recordActivation = async () => {
    await c.var.db.insert(telemetryEvents).values({
      orgSlug: org,
      skillRepo: repo,
      eventType: "activation",
      userId: access.actorType === "user" ? access.actorId : null,
      apiKeyId: access.actorType === "api_key" ? c.var.auth.apiKeyId : null,
    });
  };

  if (body.stream) {
    const encoder = new TextEncoder();
    // Abort the run if the client disconnects (stream cancelled), so the hosted
    // container doesn't keep running to its timeout with nobody reading.
    const runAbort = new AbortController();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        try {
          const result = await runSkillScript(c.env, c.var.db, {
            ...runInput,
            signal: runAbort.signal,
            onOutput: (outputStream, chunk) => {
              send("output", { stream: outputStream, chunk });
            },
          });
          await recordActivation();
          send("done", result);
        } catch (err) {
          send("error", {
            message: err instanceof Error ? err.message : "Execution failed",
          });
        } finally {
          controller.close();
        }
      },
      cancel() {
        runAbort.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  try {
    const result = await runSkillScript(c.env, c.var.db, runInput);
    await recordActivation();
    return c.json(result, 200);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Execution failed" }, 400);
  }
});

const listRunsRoute = createRoute({
  method: "get",
  path: "/{org}/{repo}/runs",
  tags: ["Execution"],
  request: {
    params: orgRepoParams,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  },
  responses: { 200: { description: "Run history" } },
});

executionRoutes.openapi(listRunsRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const { limit } = c.req.valid("query");

  const loaded = await loadOrgSkill(c.var.db, org, repo);
  if (!loaded) return c.json({ error: "Not found" }, 404);

  const access = await assertSkillRunAccess(c.var.db, c.var.auth, loaded.org, loaded.skill);
  if (!access.ok) {
    return c.json(
      {
        error: access.status === 401 ? "Authentication required" : "Forbidden",
      },
      access.status === 401 ? 401 : 403,
    );
  }

  const items = await c.var.db
    .select()
    .from(skillRuns)
    .where(eq(skillRuns.skillId, loaded.skill.id))
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
  const [run] = await c.var.db.select().from(skillRuns).where(eq(skillRuns.id, id)).limit(1);
  if (!run) return c.json({ error: "Not found" }, 404);

  const loaded = await loadOrgSkill(c.var.db, run.orgSlug, run.skillRepo);
  if (!loaded) return c.json({ error: "Not found" }, 404);

  const access = await assertSkillRunAccess(c.var.db, c.var.auth, loaded.org, loaded.skill);
  if (!access.ok) {
    return c.json(
      {
        error: access.status === 401 ? "Authentication required" : "Forbidden",
      },
      access.status === 401 ? 401 : 403,
    );
  }

  return c.json(run, 200);
});
