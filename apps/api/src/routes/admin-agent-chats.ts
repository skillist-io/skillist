import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { agentChats } from "@skillist/db/schema";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import { purgeChat, unclaimedObjectIds } from "../lib/agent/orphan-chats";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { errorResponses } from "../lib/openapi";
import { requireDocsAdmin } from "./admin-docs";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

/**
 * What `pnpm purge:orphan-chats` calls. Platform admins only, and a key needs its own
 * `admin:agent-chats` scope. See lib/agent/orphan-chats.ts for why it's split this way.
 */
export const adminAgentChatsRoutes = new OpenAPIHono<AppEnv>();

const objectId = z.string().regex(/^[0-9a-fA-F]{64}$/);

const unclaimedRoute = createRoute({
  method: "post",
  path: "/admin/agent-chats/unclaimed",
  tags: ["Admin"],
  operationId: "findUnclaimedAgentChats",
  summary: "Which chat object ids no conversation row accounts for",
  request: {
    body: {
      content: {
        "application/json": { schema: z.object({ objectIds: z.array(objectId).min(1).max(1000) }) },
      },
    },
  },
  responses: {
    200: {
      description: "The ids with no row. Reads rows only and opens no object.",
      content: {
        "application/json": { schema: z.object({ unclaimed: z.array(z.string()) }) },
      },
    },
    ...errorResponses({ notFound: false }),
  },
});

adminAgentChatsRoutes.openapi(unclaimedRoute, async (c) => {
  const gate = requireDocsAdmin(c.env, c.var.auth, "admin:agent-chats");
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const { objectIds } = c.req.valid("json");
  // Every row, on each call. This is a rare manual job, and an id can only be matched
  // by hashing every name, so there's nothing narrower to select.
  const rows = await c.var.db
    .select({ id: agentChats.id, orgId: agentChats.orgId, userId: agentChats.userId })
    .from(agentChats);
  return c.json({ unclaimed: unclaimedObjectIds(c.env.SKILLIST_AGENT, rows, objectIds) }, 200);
});

const purgeRoute = createRoute({
  method: "post",
  path: "/admin/agent-chats/purge",
  tags: ["Admin"],
  operationId: "purgeOrphanAgentChats",
  summary: "Permanently wipe chat objects that have no conversation row",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            chats: z
              .array(
                z.object({
                  objectId,
                  orgId: z.string().min(1),
                  userId: z.string().min(1),
                  chatId: z.string().min(1),
                }),
              )
              .min(1)
              .max(25),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "One outcome per chat. Only `wiped` deleted anything.",
      content: {
        "application/json": {
          schema: z.object({
            results: z.array(
              z.object({
                objectId: z.string(),
                outcome: z.enum(["wiped", "has_row", "id_mismatch", "failed"]),
              }),
            ),
          }),
        },
      },
    },
    ...errorResponses({ notFound: false }),
  },
});

adminAgentChatsRoutes.openapi(purgeRoute, async (c) => {
  const gate = requireDocsAdmin(c.env, c.var.auth, "admin:agent-chats");
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const { db } = c.var;
  const hasRow = async (chatId: string) => {
    const [row] = await db
      .select({ id: agentChats.id })
      .from(agentChats)
      .where(eq(agentChats.id, chatId))
      .limit(1);
    return Boolean(row);
  };

  const results = [];
  // One at a time: each is a Durable Object round trip plus a wipe, and a failure
  // should be reported against the chat it happened to.
  for (const chat of c.req.valid("json").chats) {
    const outcome = await purgeChat(c.env.SKILLIST_AGENT, chat, hasRow);
    console.log(JSON.stringify({ event: "agent_chat_purge", actor: gate.actor, ...chat, outcome }));
    results.push({ objectId: chat.objectId, outcome });
  }
  return c.json({ results }, 200);
});
