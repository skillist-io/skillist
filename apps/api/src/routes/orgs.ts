// @ts-nocheck
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createApiKeySchema, createOrgSchema, inviteMemberSchema } from "@skillist/contracts";
import { apiKeys, organizations, orgMembers } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { requireOrgRole } from "../lib/org-access";
import { sha256 } from "../lib/r2";
import { resolveUserId } from "../lib/session";

type AppEnv = {
  Bindings: Env;
  Variables: {
    auth: AuthContext;
    db: WorkerDb;
  };
};

export const orgRoutes = new OpenAPIHono<AppEnv>();

const listOrgsRoute = createRoute({
  method: "get",
  path: "/orgs",
  tags: ["Organizations"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              id: z.string().uuid(),
              name: z.string(),
              slug: z.string(),
              role: z.string(),
            }),
          ),
        },
      },
      description: "List organizations for current user",
    },
  },
});

orgRoutes.openapi(listOrgsRoute, async (c) => {
  const auth = c.var.auth;
  if (auth.apiKeyId && auth.apiKeyOrgId) {
    const [org] = await c.var.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
      })
      .from(organizations)
      .where(eq(organizations.id, auth.apiKeyOrgId))
      .limit(1);
    if (!org) return c.json({ error: "Unauthorized" }, 401);
    return c.json([{ ...org, role: "editor" }], 200);
  }

  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const rows = await c.var.db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(eq(orgMembers.userId, userId));
  return c.json(rows, 200);
});

const createOrgRoute = createRoute({
  method: "post",
  path: "/orgs",
  tags: ["Organizations"],
  request: {
    body: {
      content: { "application/json": { schema: createOrgSchema } },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().uuid(),
            name: z.string(),
            slug: z.string(),
          }),
        },
      },
      description: "Organization created",
    },
  },
});

orgRoutes.openapi(createOrgRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const body = c.req.valid("json");
  const [org] = await c.var.db
    .insert(organizations)
    .values({ name: body.name, slug: body.slug })
    .returning();
  if (!org) return c.json({ error: "Failed to create org" }, 500);
  await c.var.db.insert(orgMembers).values({
    orgId: org.id,
    userId,
    role: "owner",
  });
  return c.json(org, 201);
});

const inviteRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/members",
  tags: ["Organizations"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: {
      content: { "application/json": { schema: inviteMemberSchema } },
    },
  },
  responses: { 201: { description: "Member invited" } },
});

orgRoutes.openapi(inviteRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const body = c.req.valid("json");
  const { users } = await import("@skillist/db/schema");
  const [user] = await c.var.db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (!user) return c.json({ error: "User not found" }, 404);
  await c.var.db.insert(orgMembers).values({
    orgId,
    userId: user.id,
    role: body.role,
  });
  return c.json({ ok: true }, 201);
});

const createApiKeyRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/api-keys",
  tags: ["API Keys"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: {
      content: { "application/json": { schema: createApiKeySchema } },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().uuid(),
            key: z.string(),
            prefix: z.string(),
          }),
        },
      },
      description: "API key created",
    },
  },
});

orgRoutes.openapi(createApiKeyRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const body = c.req.valid("json");
  const rawKey = `sk_${crypto.randomUUID().replace(/-/g, "")}`;
  const keyHash = await sha256(rawKey);
  const keyPrefix = rawKey.slice(0, 12);
  const [record] = await c.var.db
    .insert(apiKeys)
    .values({
      orgId,
      name: body.name,
      keyHash,
      keyPrefix,
      scopes: body.scopes,
      createdBy: userId,
    })
    .returning();
  return c.json({ id: record!.id, key: rawKey, prefix: keyPrefix }, 201);
});

const listApiKeysRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/api-keys",
  tags: ["API Keys"],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              id: z.string().uuid(),
              name: z.string(),
              prefix: z.string(),
              scopes: z.array(z.string()),
              lastUsedAt: z.string().nullable(),
              createdAt: z.string(),
            }),
          ),
        },
      },
      description: "List API keys",
    },
  },
});

orgRoutes.openapi(listApiKeysRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const rows = await c.var.db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.orgId, orgId));

  return c.json(
    rows.map((row) => ({
      ...row,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    200,
  );
});

const revokeApiKeyRoute = createRoute({
  method: "delete",
  path: "/orgs/{orgId}/api-keys/{keyId}",
  tags: ["API Keys"],
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      keyId: z.string().uuid(),
    }),
  },
  responses: { 200: { description: "API key revoked" } },
});

orgRoutes.openapi(revokeApiKeyRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId, keyId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  await c.var.db.delete(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.orgId, orgId)));

  return c.json({ ok: true }, 200);
});
