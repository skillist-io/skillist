import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createHarnessSessionSchema, harnessTurnSchema } from "@skillist/contracts";
import { runTurn } from "@skillist/harness";
import type { ModelMessage } from "ai";
import { buildAgentModel } from "../agent/model";
import type { Env } from "../env";
import { logAudit } from "../lib/audit";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { loadSession } from "../lib/harness-host";
import { errorResponses } from "../lib/openapi";
import { requireOrgAccess } from "../lib/org-access";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const harnessRoutes = new OpenAPIHono<AppEnv>();

/**
 * Off unless HARNESS_ENABLED is "true". Limits so far are per session, and
 * sessions are free to create, so an open deployment would let any account
 * spend the platform's model budget without bound. Keep this off in production
 * until an org-level budget exists.
 */
harnessRoutes.use("/orgs/:orgId/harness/*", async (c, next) => {
  if (c.env.HARNESS_ENABLED !== "true") return c.json({ error: "Not found" }, 404);
  await next();
});

const sessionParams = z.object({ orgId: z.string().uuid(), sessionId: z.string().uuid() });

const sessionSchema = z.object({
  id: z.string().uuid(),
  skills: z.array(z.string()),
  allowScripts: z.boolean(),
  createdAt: z.string(),
});

function sessionStub(env: Env, orgId: string, sessionId: string) {
  // The org is part of the name, so one org's id can't address another's session.
  return env.SKILL_HARNESS.get(env.SKILL_HARNESS.idFromName(`${orgId}:${sessionId}`));
}

/** A key's sessions belong to that key, not its creator: keys are revoked separately. */
function ownerOf(auth: AuthContext): string | null {
  if (auth.apiKeyId) return `key:${auth.apiKeyId}`;
  return auth.userId ? `user:${auth.userId}` : null;
}

const createSessionRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/harness/sessions",
  tags: ["Harness"],
  operationId: "createHarnessSession",
  summary: "Start a skills harness session",
  description:
    "A session is limited to the skills named here. Scripts stay off unless `allowScripts` is true.",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: createHarnessSessionSchema } } },
  },
  responses: {
    201: {
      description: "Session created",
      content: { "application/json": { schema: sessionSchema } },
    },
    ...errorResponses(),
  },
});

harnessRoutes.openapi(createSessionRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { skills, allowScripts } = c.req.valid("json");

  // skills:run, not skills:read: every turn spends model tokens and possibly
  // sandbox compute, so a read-only key must not reach this at all.
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:run",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const ownerId = ownerOf(c.var.auth);
  if (!ownerId) return c.json({ error: "Forbidden" }, 403);

  const refs = [...new Set(skills)];
  const { missing } = await loadSession(c.env, c.var.db, c.var.auth, refs);
  if (missing.length > 0) {
    return c.json({ error: `Skill not available: ${missing.join(", ")}` }, 404);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await sessionStub(c.env, orgId, id).init({
    orgId,
    ownerId,
    skills: refs,
    allowScripts,
    createdAt,
  });

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "harness.session.created",
    resourceType: "harness_session",
    resourceId: id,
    metadata: { skills: refs, allowScripts },
  });

  return c.json({ id, skills: refs, allowScripts, createdAt }, 201);
});

const createTurnRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/harness/sessions/{sessionId}/turns",
  tags: ["Harness"],
  operationId: "createHarnessTurn",
  summary: "Send a message and run the session's skills",
  request: {
    params: sessionParams,
    body: { content: { "application/json": { schema: harnessTurnSchema } } },
  },
  responses: {
    200: {
      description: "The turn finished",
      content: {
        "application/json": {
          schema: z.object({
            text: z.string(),
            turn: z.number(),
            steps: z.number(),
            finishReason: z.string(),
            inputTokens: z.number(),
            outputTokens: z.number(),
          }),
        },
      },
    },
    ...errorResponses({ conflict: true }),
  },
});

harnessRoutes.openapi(createTurnRoute, async (c) => {
  const { orgId, sessionId } = c.req.valid("param");
  const { message } = c.req.valid("json");

  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:run",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const stub = sessionStub(c.env, orgId, sessionId);
  const meta = await stub.getMeta();
  if (!meta || meta.ownerId !== ownerOf(c.var.auth)) return c.json({ error: "Not found" }, 404);

  const { catalog, host } = await loadSession(
    c.env,
    c.var.db,
    c.var.auth,
    meta.skills,
    c.req.raw.signal,
  );
  // Checked before taking a turn, so a session with nothing left doesn't burn one.
  if (catalog.listed().length === 0) {
    return c.json({ error: "No skills in this session are available" }, 409);
  }

  const begun = await stub.beginTurn();
  if (!begun.ok) {
    const error = begun.reason === "busy" ? "A turn is already running" : "Session turn limit hit";
    return c.json({ error }, 409);
  }

  let result: Awaited<ReturnType<typeof runTurn>>;
  let saved: boolean;
  try {
    const stored = await stub.history();
    result = await runTurn({
      model: buildAgentModel(c.env, { sessionAffinity: sessionId }),
      catalog,
      host,
      history: stored.map((raw) => JSON.parse(raw) as ModelMessage),
      message,
      allowScripts: meta.allowScripts,
      abortSignal: c.req.raw.signal,
      onStep: async () => {
        await stub.renewTurn(begun.token);
      },
    });
    // Inside the try: a failed append must release the lease too, or the session
    // reads as busy until the lease expires.
    saved = await stub.completeTurn(
      begun.token,
      begun.turn,
      result.messages.map((m) => JSON.stringify(m)),
    );
  } catch (err) {
    // waitUntil, because this often runs after the client has disconnected.
    c.executionCtx.waitUntil(stub.abandonTurn(begun.token));
    throw err;
  }

  if (!saved) return c.json({ error: "The turn outlived its lease and was discarded" }, 409);

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "harness.turn.completed",
    resourceType: "harness_session",
    resourceId: sessionId,
    metadata: {
      turn: begun.turn,
      steps: result.steps,
      finishReason: result.finishReason,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  });

  return c.json(
    {
      text: result.text,
      turn: begun.turn,
      steps: result.steps,
      finishReason: result.finishReason,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
    200,
  );
});

const listEventsRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/harness/sessions/{sessionId}/events",
  tags: ["Harness"],
  operationId: "listHarnessEvents",
  summary: "Read a session's event log",
  request: {
    params: sessionParams,
    query: z.object({
      after: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
  },
  responses: {
    200: {
      description: "Events in order",
      content: {
        "application/json": {
          schema: z.object({
            events: z.array(
              z.object({
                seq: z.number(),
                turn: z.number(),
                message: z.unknown(),
                createdAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    ...errorResponses(),
  },
});

harnessRoutes.openapi(listEventsRoute, async (c) => {
  const { orgId, sessionId } = c.req.valid("param");
  const { after, limit } = c.req.valid("query");

  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const stub = sessionStub(c.env, orgId, sessionId);
  const meta = await stub.getMeta();
  if (!meta || meta.ownerId !== ownerOf(c.var.auth)) return c.json({ error: "Not found" }, 404);

  const events = await stub.events(after, limit);
  return c.json(
    { events: events.map((event) => ({ ...event, message: JSON.parse(event.message) })) },
    200,
  );
});
