import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { agentChats } from "@skillist/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { composeAgentName } from "../agent/agent-name";
import type { SkillistAgent } from "../agent/skillist-agent";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { errorResponses } from "../lib/openapi";
import { requireOrgAccess } from "../lib/org-access";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const agentChatsRoutes = new OpenAPIHono<AppEnv>();

const chatSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/agent/chats",
  tags: ["Agent"],
  operationId: "listAgentChats",
  summary: "List the caller's platform-agent conversations",
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: {
    200: {
      description: "The caller's conversations in this org, newest first",
      content: { "application/json": { schema: z.object({ chats: z.array(chatSummarySchema) }) } },
    },
    ...errorResponses({ validates: false, notFound: false }),
  },
});

/**
 * The caller's own agent conversations (agentChats where orgId + userId = the
 * session user), newest-first. The DO owns the messages; this table is just the
 * sidebar index (title + timestamps), so the list survives reloads and works
 * across browsers.
 */
agentChatsRoutes.openapi(listRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  // Chats are per-user; an actor with no resolvable user id (e.g. an API key
  // with no creator) has none.
  const userId = access.actorId;
  if (!userId) return c.json({ chats: [] }, 200);

  const rows = await c.var.db
    .select({
      id: agentChats.id,
      title: agentChats.title,
      createdAt: agentChats.createdAt,
      updatedAt: agentChats.updatedAt,
    })
    .from(agentChats)
    .where(and(eq(agentChats.orgId, orgId), eq(agentChats.userId, userId)))
    .orderBy(desc(agentChats.updatedAt));

  return c.json(
    {
      chats: rows.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    },
    200,
  );
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/orgs/{orgId}/agent/chats/{chatId}",
  tags: ["Agent"],
  operationId: "deleteAgentChat",
  summary: "Delete one of the caller's platform-agent conversations",
  request: {
    params: z.object({ orgId: z.string().uuid(), chatId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Deleted",
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
    },
    ...errorResponses(),
  },
});

/**
 * Delete a conversation: verify the caller owns the row, remove it, AND wipe
 * the underlying Durable Object so no persisted messages linger. Both cleanups
 * are funneled here so the client only makes one round-trip.
 */
agentChatsRoutes.openapi(deleteRoute, async (c) => {
  const { orgId, chatId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const userId = access.actorId;
  if (!userId) return c.json({ error: "Not found" }, 404);

  // Ownership: the row must belong to the caller. The DELETE's userId filter is
  // the actual guard; the pre-check drives the 404 vs 200 response.
  const [row] = await c.var.db
    .select({ userId: agentChats.userId })
    .from(agentChats)
    .where(and(eq(agentChats.id, chatId), eq(agentChats.orgId, orgId)))
    .limit(1);
  if (!row || row.userId !== userId) {
    return c.json({ error: "Not found" }, 404);
  }

  await c.var.db
    .delete(agentChats)
    .where(
      and(eq(agentChats.id, chatId), eq(agentChats.orgId, orgId), eq(agentChats.userId, userId)),
    );

  // Wipe the DO. Its instance name is the un-spoofable `orgId::userId::chatId`
  // (the same value the /agents gate composes). Best-effort — a cleanup failure
  // must not fail the delete, since the row is already gone.
  try {
    const name = composeAgentName(orgId, userId, chatId);
    const ns = c.env.SKILLIST_AGENT;
    const stub = ns.get(ns.idFromName(name)) as unknown as SkillistAgent;
    await stub.cleanup();
  } catch (err) {
    console.warn("SkillistAgent.cleanup failed during DELETE /agent/chats", err);
  }

  return c.json({ ok: true }, 200);
});
