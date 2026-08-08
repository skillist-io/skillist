import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { runSkillSchema } from "@skillist/contracts";
import { organizations, skillRuns, skills, telemetryEvents } from "@skillist/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { describeError, isDatabaseError } from "../lib/error-detail";
import { errorResponses } from "../lib/openapi";
import { requireOrgAccess } from "../lib/org-access";
import { checkRunQuota, RunQuotaExceededError } from "../lib/run-quota";
import { assertSkillRunAccess } from "../lib/skill-execution-access";
import {
  getPublishedBundle,
  getRunnableScriptsFromBundle,
  runSkillScript,
  SkillExecutionBlockedError,
  SkillNotFoundError,
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

/** A row of `skill_runs`; timestamps serialize to ISO strings. */
const skillRunSchema = z.object({
  id: z.string().uuid(),
  skillId: z.string().uuid(),
  versionId: z.string().uuid(),
  orgSlug: z.string(),
  skillRepo: z.string(),
  scriptPath: z.string(),
  runtime: z.string(),
  status: z.string(),
  args: z.array(z.string()).nullable(),
  targetUrl: z.string().nullable(),
  stdout: z.string().nullable(),
  stderr: z.string().nullable(),
  exitCode: z.number().nullable(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
  actorId: z.string().nullable(),
  actorType: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

const listScriptsRoute = createRoute({
  method: "get",
  path: "/{org}/{repo}/scripts",
  tags: ["Execution"],
  operationId: "listSkillScripts",
  summary: "List a published skill's runnable scripts",
  request: { params: orgRepoParams },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            runtime: z.string(),
            /** Allowlisted `scripts/*` paths in the published bundle. */
            scripts: z.array(z.string()),
          }),
        },
      },
      description: "Runnable scripts",
    },
    ...errorResponses(),
  },
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
    // Only a genuinely missing skill is a 404. Anything else — a database or R2
    // failure — propagates to the global handler, which logs it and answers 500
    // instead of reporting infrastructure trouble as a client mistake.
    if (err instanceof SkillNotFoundError) return c.json({ error: "Not found" }, 404);
    throw err;
  }
});

const runScriptRoute = createRoute({
  method: "post",
  path: "/{org}/{repo}/run",
  tags: ["Execution"],
  operationId: "runSkill",
  summary: "Run a skill script in a hosted sandbox",
  request: {
    params: orgRepoParams,
    body: { content: { "application/json": { schema: runSkillSchema } } },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            runId: z.string().uuid(),
            status: z.enum(["completed", "failed"]),
            stdout: z.string(),
            stderr: z.string(),
            exitCode: z.number(),
            durationMs: z.number(),
            runtime: z.string(),
          }),
        },
        // With `stream: true` the same 200 is an event stream instead: `output`
        // frames while the script runs, then a `done` frame carrying the JSON
        // result above (or an `error` frame).
        "text/event-stream": { schema: z.string() },
      },
      description: "Execution result",
    },
    ...errorResponses(),
  },
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
    // Passed through so the run-row insert can re-check quota atomically under a
    // per-org lock (the check above is only a fast, non-authoritative pre-check).
    executionPolicy: loaded.org.executionPolicy,
    isAnonymous: access.isAnonymous,
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
          // The response has already started, so this cannot fall through to
          // the global handler — log it here and send the client a sanitized
          // message rather than streaming raw SQL into the browser.
          if (isDatabaseError(err)) {
            console.error(JSON.stringify({ msg: "run_stream_error", ...describeError(err) }));
            send("error", { message: "Execution failed" });
          } else {
            send("error", { message: err instanceof Error ? err.message : "Execution failed" });
          }
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
    if (err instanceof RunQuotaExceededError) {
      return c.json({ error: err.message }, 429);
    }
    if (err instanceof SkillExecutionBlockedError) {
      return c.json({ error: err.message }, 403);
    }
    if (err instanceof SkillNotFoundError) {
      return c.json({ error: "Not found" }, 404);
    }
    // A failed script is the caller's problem (400) and its message is useful.
    // A failed database call is ours, and its message is the raw SQL — hand it
    // to the global handler so it is logged and answered as a 500.
    if (isDatabaseError(err)) throw err;
    return c.json({ error: err instanceof Error ? err.message : "Execution failed" }, 400);
  }
});

const listRunsRoute = createRoute({
  method: "get",
  path: "/{org}/{repo}/runs",
  tags: ["Execution"],
  operationId: "listSkillRuns",
  summary: "List recent runs of a skill",
  request: {
    params: orgRepoParams,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ items: z.array(skillRunSchema) }) } },
      description: "Run history",
    },
    ...errorResponses(),
  },
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

  // Run rows carry stdout/stderr/args/targetUrl, which routinely hold the
  // caller's secrets. For a PUBLIC skill `assertSkillRunAccess` passes for ANY
  // authenticated user, so a non-member must only see their OWN runs — org
  // members (any role) get the full history for skills their org owns.
  const orgAccess = await requireOrgAccess(c.var.db, loaded.skill.orgId, c.var.auth, "viewer");
  const where = orgAccess.ok
    ? eq(skillRuns.skillId, loaded.skill.id)
    : and(eq(skillRuns.skillId, loaded.skill.id), eq(skillRuns.actorId, access.actorId ?? ""));

  const items = await c.var.db
    .select()
    .from(skillRuns)
    .where(where)
    .orderBy(desc(skillRuns.createdAt))
    .limit(limit);

  return c.json({ items }, 200);
});

const getRunRoute = createRoute({
  method: "get",
  path: "/runs/{id}",
  tags: ["Execution"],
  operationId: "getSkillRun",
  summary: "Get a single skill run's detail",
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      content: { "application/json": { schema: skillRunSchema } },
      description: "Run detail",
    },
    ...errorResponses(),
  },
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

  // Same tenant-isolation rule as the run list: on a public skill a non-member
  // may only read a run they created (its I/O can carry their secrets). 404 —
  // not 403 — so the endpoint doesn't confirm the run exists to a stranger.
  const orgAccess = await requireOrgAccess(c.var.db, loaded.skill.orgId, c.var.auth, "viewer");
  if (!orgAccess.ok && run.actorId !== access.actorId) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(run, 200);
});
