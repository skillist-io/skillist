// @ts-nocheck
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import {
  createOrgSchema,
  inviteMemberSchema,
  createApiKeySchema,
} from "@skillist/contracts";
import { organizations, orgMembers, apiKeys } from "@skillist/db/schema";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import { requireOrgRole } from "../lib/org-access";
import { sha256 } from "../lib/r2";
import type { WorkerDb } from "../lib/db";
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
  const [user] = await c.var.db
    .select()
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1);
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
