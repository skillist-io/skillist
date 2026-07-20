import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createApiKeySchema, createOrgSchema, inviteMemberSchema } from "@skillist/contracts";
import { apiKeys, organizations, orgMembers, users } from "@skillist/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { Env } from "../env";
import { logAudit } from "../lib/audit";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { errorResponses, okSchema } from "../lib/openapi";
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
  operationId: "listOrgs",
  summary: "List organizations the caller belongs to",
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
    ...errorResponses({ validates: false, notFound: false }),
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
  operationId: "createOrg",
  summary: "Create an organization",
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
    ...errorResponses({ notFound: false }),
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
  operationId: "inviteOrgMember",
  summary: "Add an existing user to an organization",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: {
      content: { "application/json": { schema: inviteMemberSchema } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: okSchema } },
      description: "Member invited",
    },
    ...errorResponses(),
  },
});

orgRoutes.openapi(inviteRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const body = c.req.valid("json");
  const [user] = await c.var.db.select().from(users).where(eq(users.email, body.email)).limit(1);
  if (!user) return c.json({ error: "User not found" }, 404);
  await c.var.db.insert(orgMembers).values({
    orgId,
    userId: user.id,
    role: body.role,
  });
  // Granting org access is a privilege change; record who granted what to whom.
  await logAudit(c.var.db, {
    orgId,
    actorId: userId,
    actorType: "user",
    action: "org.member.add",
    resourceType: "org_member",
    resourceId: user.id,
    metadata: { email: body.email, role: body.role },
  });
  return c.json({ ok: true }, 201);
});

const listMembersRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/members",
  tags: ["Organizations"],
  operationId: "listOrgMembers",
  summary: "List an organization's members",
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              userId: z.string(),
              name: z.string().nullable(),
              email: z.string().nullable(),
              role: z.string(),
            }),
          ),
        },
      },
      description: "List org members",
    },
    ...errorResponses(),
  },
});

orgRoutes.openapi(listMembersRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId } = c.req.valid("param");
  // Any org member may view the roster (used by the project-member picker).
  const access = await requireOrgRole(c.var.db, orgId, userId, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const rows = await c.var.db
    .select({
      userId: orgMembers.userId,
      name: users.name,
      email: users.email,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .leftJoin(users, eq(orgMembers.userId, users.id))
    .where(eq(orgMembers.orgId, orgId));

  return c.json(rows, 200);
});

const createApiKeyRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/api-keys",
  tags: ["API Keys"],
  operationId: "createOrgApiKey",
  summary: "Mint an API key for an organization",
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
    ...errorResponses(),
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
  const expiresAt = body.expiresInDays
    ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
    : null;
  const [record] = await c.var.db
    .insert(apiKeys)
    .values({
      orgId,
      name: body.name,
      keyHash,
      keyPrefix,
      scopes: body.scopes,
      createdBy: userId,
      expiresAt,
    })
    .returning();
  // Minting a credential is exactly the kind of action an incident review needs
  // to reconstruct. Never log the key or its hash — prefix and scopes are
  // enough to identify which credential was created.
  await logAudit(c.var.db, {
    orgId,
    actorId: userId,
    actorType: "user",
    action: "api_key.create",
    resourceType: "api_key",
    resourceId: record!.id,
    metadata: {
      name: body.name,
      prefix: keyPrefix,
      scopes: body.scopes,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
  });
  return c.json({ id: record!.id, key: rawKey, prefix: keyPrefix }, 201);
});

const listApiKeysRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/api-keys",
  tags: ["API Keys"],
  operationId: "listOrgApiKeys",
  summary: "List an organization's active API keys",
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
    ...errorResponses(),
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
    .where(and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)));

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
  // Soft-revoke rather than a hard delete, hence "revoke" over "delete".
  operationId: "revokeOrgApiKey",
  summary: "Revoke an organization API key",
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      keyId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "API key revoked",
    },
    ...errorResponses(),
  },
});

orgRoutes.openapi(revokeApiKeyRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId, keyId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  // Soft-revoke: mark the key revoked (auth rejects it immediately) but keep the
  // row so its audit trail and last-used history survive.
  const revoked = await c.var.db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id, prefix: apiKeys.keyPrefix });

  // Only audit when a row actually changed — re-revoking an already-revoked key
  // is a no-op and should not manufacture an event.
  if (revoked.length > 0) {
    await logAudit(c.var.db, {
      orgId,
      actorId: userId,
      actorType: "user",
      action: "api_key.revoke",
      resourceType: "api_key",
      resourceId: keyId,
      metadata: { prefix: revoked[0]!.prefix },
    });
  }

  return c.json({ ok: true }, 200);
});
