import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { mcpServerSchema } from "@skillist/contracts";
import { organizations, orgMcpServers } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import { logAudit } from "../../lib/audit";
import { errorResponses } from "../../lib/openapi";
import { requireOrgAccess } from "../../lib/org-access";
import type { AppEnv } from "./shared";

export const mcpServersRoutes = new OpenAPIHono<AppEnv>();

const listMcpServersRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/mcp-servers",
  tags: ["MCP Gateway"],
  operationId: "listMcpServers",
  summary: "List an organization's gateway MCP servers",
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: {
    200: { description: "Org MCP gateway servers" },
    ...errorResponses({ validates: false, notFound: false }),
  },
});

mcpServersRoutes.openapi(listMcpServersRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const items = await c.var.db
    .select({
      id: orgMcpServers.id,
      name: orgMcpServers.name,
      upstreamUrl: orgMcpServers.upstreamUrl,
      transport: orgMcpServers.transport,
      status: orgMcpServers.status,
      createdAt: orgMcpServers.createdAt,
    })
    .from(orgMcpServers)
    .where(eq(orgMcpServers.orgId, orgId));

  return c.json({ items }, 200);
});

const createMcpServerRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/mcp-servers",
  tags: ["MCP Gateway"],
  operationId: "createMcpServer",
  summary: "Register an upstream MCP server for an organization",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: mcpServerSchema } } },
  },
  responses: {
    201: { description: "MCP server registered" },
    ...errorResponses({ notFound: false, conflict: true }),
  },
});

mcpServersRoutes.openapi(createMcpServerRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [row] = await c.var.db
    .insert(orgMcpServers)
    .values({
      orgId,
      name: body.name,
      upstreamUrl: body.upstreamUrl,
      transport: body.transport,
      oauthClientId: body.oauthClientId ?? null,
      oauthClientSecret: body.oauthClientSecret ?? null,
      oauthScope: body.oauthScope ?? null,
      oauthResourceUrl: body.oauthResourceUrl ?? null,
      oauthAuthorizationServerUrl: body.oauthAuthorizationServerUrl ?? null,
      status: "unauthorized",
    })
    .returning({
      id: orgMcpServers.id,
      name: orgMcpServers.name,
      upstreamUrl: orgMcpServers.upstreamUrl,
      transport: orgMcpServers.transport,
      status: orgMcpServers.status,
    });

  await logAudit(c.var.db, {
    orgId,
    actorId: access.actorId,
    actorType: access.actorType,
    action: "mcp_server.created",
    resourceType: "mcp_server",
    resourceId: row?.id ?? null,
    metadata: { name: body.name },
  });

  return c.json(row, 201);
});

const authorizeMcpServerRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/mcp-servers/{name}/authorize",
  tags: ["MCP Gateway"],
  operationId: "authorizeMcpServer",
  summary: "Store OAuth credentials for a registered MCP server",
  request: {
    params: z.object({ orgId: z.string().uuid(), name: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            accessToken: z.string().min(1),
            refreshToken: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "MCP server authorized" },
    ...errorResponses(),
  },
});

mcpServersRoutes.openapi(authorizeMcpServerRoute, async (c) => {
  const { orgId, name } = c.req.valid("param");
  const body = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [row] = await c.var.db
    .update(orgMcpServers)
    .set({
      accessToken: body.accessToken,
      refreshToken: body.refreshToken ?? null,
      status: "authorized",
      updatedAt: new Date(),
    })
    .where(and(eq(orgMcpServers.orgId, orgId), eq(orgMcpServers.name, name)))
    .returning({ id: orgMcpServers.id, name: orgMcpServers.name, status: orgMcpServers.status });

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row, 200);
});

const getMcpProxyConfigRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/mcp-servers/{name}/proxy",
  tags: ["MCP Gateway"],
  operationId: "getMcpProxyConfig",
  summary: "Get the proxy connection config for an authorized MCP server",
  request: { params: z.object({ orgId: z.string().uuid(), name: z.string() }) },
  responses: {
    200: { description: "MCP proxy connection config" },
    ...errorResponses({ conflict: true }),
  },
});

mcpServersRoutes.openapi(getMcpProxyConfigRoute, async (c) => {
  const { orgId, name } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [row] = await c.var.db
    .select()
    .from(orgMcpServers)
    .where(and(eq(orgMcpServers.orgId, orgId), eq(orgMcpServers.name, name)))
    .limit(1);

  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.status !== "authorized" || !row.accessToken) {
    return c.json({ error: "MCP server is not authorized" }, 409);
  }

  return c.json(
    {
      name: row.name,
      upstreamUrl: row.upstreamUrl,
      transport: row.transport,
      accessToken: row.accessToken,
      orgSlug: (
        await c.var.db
          .select({ slug: organizations.slug })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1)
      )[0]?.slug,
    },
    200,
  );
});
