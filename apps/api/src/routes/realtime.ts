import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { organizations, skills } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { errorResponses } from "../lib/openapi";
import { requireOrgAccess } from "../lib/org-access";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const realtimeRoutes = new OpenAPIHono<AppEnv>();

/**
 * Subscriptions are public for public skills, but private-skill publish events
 * (version, etag, publish cadence) must not leak to non-members. Resolve the
 * skill by org slug + repo and, when it isn't public, require org access before
 * connecting to the hub. Returns null when the caller may connect, or a Response
 * to return instead (404 for unknown/forbidden — never confirm a private skill's
 * existence to a non-member).
 */
async function guardSubscription(
  c: { var: { db: WorkerDb; auth: AuthContext } },
  org: string,
  repo: string,
): Promise<Response | null> {
  const [orgRow] = await c.var.db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, org))
    .limit(1);
  if (!orgRow) return Response.json({ error: "Not found" }, { status: 404 });

  const [skill] = await c.var.db
    .select({ visibility: skills.visibility })
    .from(skills)
    .where(and(eq(skills.orgId, orgRow.id), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return Response.json({ error: "Not found" }, { status: 404 });

  if (skill.visibility === "public") return null;

  const access = await requireOrgAccess(c.var.db, orgRow.id, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return Response.json({ error: "Not found" }, { status: 404 });
  return null;
}

const wsRoute = createRoute({
  method: "get",
  path: "/realtime/skills/{org}/{repo}",
  tags: ["Realtime"],
  operationId: "subscribeSkillEventsWebSocket",
  summary: "Open a WebSocket stream of a skill's publish events",
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: {
    101: { description: "WebSocket upgrade" },
    ...errorResponses(),
  },
});

realtimeRoutes.openapi(wsRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const denied = await guardSubscription(c, org, repo);
  if (denied) return denied;
  const id = c.env.SKILL_HUB.idFromName(`${org}:${repo}`);
  const stub = c.env.SKILL_HUB.get(id);
  return stub.fetch("http://internal/ws", c.req.raw);
});

const sseRoute = createRoute({
  method: "get",
  path: "/events/skills/{org}/{repo}",
  tags: ["Realtime"],
  operationId: "subscribeSkillEventsSse",
  summary: "Open a server-sent-events stream of a skill's publish events",
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: {
    200: { description: "SSE stream" },
    ...errorResponses(),
  },
});

realtimeRoutes.openapi(sseRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const denied = await guardSubscription(c, org, repo);
  if (denied) return denied;
  const id = c.env.SKILL_HUB.idFromName(`${org}:${repo}`);
  const stub = c.env.SKILL_HUB.get(id);
  return stub.fetch("http://internal/sse", c.req.raw);
});
