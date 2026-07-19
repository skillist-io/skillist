import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { agentApprovalStatusSchema } from "@skillist/contracts";
import type { Env } from "../env";
import { decideApproval, listApprovals } from "../lib/agent/approvals";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { requireOrgAccess } from "../lib/org-access";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const agentApprovalsRoutes = new OpenAPIHono<AppEnv>();

const approvalSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  userId: z.string(),
  toolName: z.string(),
  callSignature: z.string(),
  args: z.record(z.string(), z.unknown()).nullable(),
  status: agentApprovalStatusSchema,
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});

const listRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/agent/approvals",
  tags: ["Agent"],
  summary: "List the caller's platform-agent approval requests",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({ status: agentApprovalStatusSchema.optional() }),
  },
  responses: {
    200: {
      description: "The caller's approval requests in this org, newest first",
      content: {
        "application/json": { schema: z.object({ approvals: z.array(approvalSchema) }) },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

agentApprovalsRoutes.openapi(listRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { status } = c.req.valid("query");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  // Approvals are per-user; an actor with no resolvable user id has none.
  const userId = access.actorId;
  if (!userId) return c.json({ approvals: [] }, 200);

  const rows = await listApprovals(c.var.db, orgId, userId, status);
  return c.json(
    {
      approvals: rows.map((r) => ({
        id: r.id,
        orgId: r.orgId,
        userId: r.userId,
        toolName: r.toolName,
        callSignature: r.callSignature,
        args: r.args ?? null,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      })),
    },
    200,
  );
});

const decideRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/agent/approvals/{id}",
  tags: ["Agent"],
  summary: "Approve or deny a pending platform-agent approval request",
  request: {
    params: z.object({ orgId: z.string().uuid(), id: z.string().uuid() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ status: z.enum(["approved", "denied"]) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Decided",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), status: agentApprovalStatusSchema }),
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: { description: "Not found or already decided" },
  },
});

agentApprovalsRoutes.openapi(decideRoute, async (c) => {
  const { orgId, id } = c.req.valid("param");
  const { status } = c.req.valid("json");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "editor", {
    apiKeyScope: "skills:write",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const userId = access.actorId;
  if (!userId) return c.json({ error: "Not found" }, 404);

  const row = await decideApproval(c.var.db, { orgId, userId, id, status });
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true, status: row.status }, 200);
});
