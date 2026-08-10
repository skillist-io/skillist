import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { invitationPreviewSchema, orgInvitationSchema } from "@skillist/contracts";
import type { Env } from "../env";
import { logAudit } from "../lib/audit";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import {
  acceptOrgInvitation,
  findPendingInvitation,
  listPendingInvitations,
  revokeOrgInvitation,
} from "../lib/invitations";
import { errorResponses, okSchema } from "../lib/openapi";
import { requireOrgRole } from "../lib/org-access";
import { resolveUserId } from "../lib/session";

type AppEnv = {
  Bindings: Env;
  Variables: {
    auth: AuthContext;
    db: WorkerDb;
  };
};

export const invitationRoutes = new OpenAPIHono<AppEnv>();

const listInvitationsRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/invitations",
  tags: ["Organizations"],
  operationId: "listOrgInvitations",
  summary: "List pending invitations for an organization",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(orgInvitationSchema) } },
      description: "Pending invitations",
    },
    ...errorResponses(),
  },
});

invitationRoutes.openapi(listInvitationsRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const rows = await listPendingInvitations(c.var.db, orgId);
  return c.json(
    rows.map((row) => ({
      ...row,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    })),
    200,
  );
});

const revokeInvitationRoute = createRoute({
  method: "delete",
  path: "/orgs/{orgId}/invitations/{invitationId}",
  tags: ["Organizations"],
  operationId: "revokeOrgInvitation",
  summary: "Revoke a pending invitation",
  request: {
    params: z.object({ orgId: z.string().uuid(), invitationId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Invitation revoked",
    },
    ...errorResponses(),
  },
});

invitationRoutes.openapi(revokeInvitationRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId, invitationId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const revoked = await revokeOrgInvitation(c.var.db, { orgId, invitationId });
  if (!revoked) return c.json({ error: "Invitation not found" }, 404);

  await logAudit(c.var.db, {
    orgId,
    actorId: userId,
    actorType: "user",
    action: "org.invitation.revoke",
    resourceType: "org_invitation",
    resourceId: revoked.id,
    metadata: { email: revoked.email },
  });
  return c.json({ ok: true }, 200);
});

const previewInvitationRoute = createRoute({
  method: "get",
  path: "/invitations/{token}",
  tags: ["Organizations"],
  operationId: "previewInvitation",
  summary: "Look up an invitation by its token",
  description:
    "Public: the token is the credential. Returns only what the console needs " +
    "to show who invited whom before the recipient signs in.",
  request: {
    params: z.object({ token: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: invitationPreviewSchema } },
      description: "Invitation details",
    },
    ...errorResponses(),
  },
});

invitationRoutes.openapi(previewInvitationRoute, async (c) => {
  const { token } = c.req.valid("param");
  const row = await findPendingInvitation(c.var.db, token);
  // One shape for every failure — unknown token, revoked, already accepted, or
  // expired all return the same 404 so the response cannot be used to probe
  // which tokens ever existed.
  if (!row) return c.json({ error: "Invitation not found" }, 404);
  return c.json({ ...row, expiresAt: row.expiresAt.toISOString() }, 200);
});

const acceptInvitationRoute = createRoute({
  method: "post",
  path: "/invitations/{token}/accept",
  tags: ["Organizations"],
  operationId: "acceptInvitation",
  summary: "Accept an invitation and join the organization",
  request: {
    params: z.object({ token: z.string().min(1) }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.literal(true), orgId: z.string().uuid(), orgSlug: z.string() }),
        },
      },
      description: "Joined the organization",
    },
    ...errorResponses(),
  },
});

invitationRoutes.openapi(acceptInvitationRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const { token } = c.req.valid("param");

  const result = await acceptOrgInvitation(c.var.db, { token, userId });
  if (!result.ok) {
    if (result.reason === "email_mismatch") {
      return c.json({ error: "This invitation was sent to a different email address" }, 403);
    }
    return c.json({ error: "Invitation not found" }, 404);
  }

  await logAudit(c.var.db, {
    orgId: result.orgId,
    actorId: userId,
    actorType: "user",
    action: "org.invitation.accept",
    resourceType: "org_member",
    resourceId: userId,
    metadata: { role: result.role },
  });

  return c.json({ ok: true as const, orgId: result.orgId, orgSlug: result.orgSlug }, 200);
});
