import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { rememberInputSchema } from "@skillist/contracts";
import type { Env } from "../env";
import { forgetFact, rememberFact, searchMemory } from "../lib/agent/memory";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { requireOrgAccess } from "../lib/org-access";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const agentMemoryRoutes = new OpenAPIHono<AppEnv>();

const memorySchema = z.object({
  id: z.string(),
  orgId: z.string(),
  userId: z.string().nullable(),
  key: z.string(),
  value: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const redactionSchema = z.array(z.object({ name: z.string(), count: z.number() }));

const listRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/agent/memory",
  tags: ["Agent"],
  summary: "List the durable governance memories visible to the caller",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({ query: z.string().optional() }),
  },
  responses: {
    200: {
      description: "Org-wide memories plus the caller's own, newest first",
      content: {
        "application/json": { schema: z.object({ memories: z.array(memorySchema) }) },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

agentMemoryRoutes.openapi(listRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { query } = c.req.valid("query");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const rows = await searchMemory(c.var.db, orgId, access.actorId, query);
  return c.json(
    {
      memories: rows.map((r) => ({
        id: r.id,
        orgId: r.orgId,
        userId: r.userId,
        key: r.key,
        value: r.value,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    },
    200,
  );
});

const upsertRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/agent/memory",
  tags: ["Agent"],
  summary: "Add or update a durable governance memory",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: rememberInputSchema } } },
  },
  responses: {
    200: {
      description: "The value was stored (PII redacted). Returns the redaction tally.",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), redacted: redactionSchema }),
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

agentMemoryRoutes.openapi(upsertRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { key, value, scope } = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "editor", {
    apiKeyScope: "skills:write",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  // "user" scope pins the memory to the caller; "org" (default) is org-wide.
  const userId = scope === "user" ? access.actorId : null;
  const { redaction } = await rememberFact(c.var.db, { orgId, userId, key, value });
  return c.json({ ok: true, redacted: redaction.matches }, 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/orgs/{orgId}/agent/memory/{key}",
  tags: ["Agent"],
  summary: "Forget a durable governance memory by key",
  request: {
    params: z.object({ orgId: z.string().uuid(), key: z.string().min(1) }),
  },
  responses: {
    200: {
      description: "Deleted (idempotent)",
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

agentMemoryRoutes.openapi(deleteRoute, async (c) => {
  const { orgId, key } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "editor", {
    apiKeyScope: "skills:write",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  await forgetFact(c.var.db, orgId, access.actorId, key);
  return c.json({ ok: true }, 200);
});
