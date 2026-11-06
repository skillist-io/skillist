import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { agentApprovalStatusSchema } from "@skillist/contracts";
import { agentChats } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import { composeAgentName } from "../agent/agent-name";
import type { SkillistAgent } from "../agent/skillist-agent";
import type { Env } from "../env";
import {
  decideApproval,
  effectiveStatus,
  executeApproval,
  getApproval,
  listApprovals,
  listOrgApprovals,
  type RecordCursor,
  revokeApproval,
} from "../lib/agent/approvals";
import { decisionLine, runApprovedAction } from "../lib/agent/approved-actions";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { errorResponses } from "../lib/openapi";
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
  chatId: z.string().nullable(),
  status: agentApprovalStatusSchema,
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  executedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedBy: z.string().nullable(),
  outcomeReason: z.string().nullable(),
});

type ApprovalRow = Awaited<ReturnType<typeof listApprovals>>[number];

function serializeApproval(r: ApprovalRow) {
  return {
    id: r.id,
    orgId: r.orgId,
    userId: r.userId,
    toolName: r.toolName,
    callSignature: r.callSignature,
    args: r.args ?? null,
    chatId: r.chatId ?? null,
    status: effectiveStatus(r),
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decidedBy: r.decidedBy ?? null,
    executedAt: r.executedAt ? r.executedAt.toISOString() : null,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    revokedBy: r.revokedBy ?? null,
    outcomeReason: r.outcomeReason ?? null,
  };
}

/**
 * Add the decision to the conversation that asked. Best-effort: the row is the record,
 * and a failure here must not read as the decision failing. Checks the chat first,
 * because reaching a deleted chat's Durable Object would bring it back.
 */
async function noteInChat(c: { env: Env; var: AppEnv["Variables"] }, row: ApprovalRow) {
  if (!row.chatId) return;
  try {
    const [chat] = await c.var.db
      .select({ id: agentChats.id })
      .from(agentChats)
      .where(and(eq(agentChats.id, row.chatId), eq(agentChats.userId, row.userId)))
      .limit(1);
    if (!chat) return;
    const ns = c.env.SKILLIST_AGENT;
    const stub = ns.get(
      ns.idFromName(composeAgentName(row.orgId, row.userId, row.chatId)),
    ) as unknown as SkillistAgent;
    await stub.noteDecision(decisionLine(row, { status: row.status, reason: row.outcomeReason }));
  } catch (err) {
    console.warn("noteDecision failed", err);
  }
}

const listRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/agent/approvals",
  tags: ["Agent"],
  operationId: "listAgentApprovals",
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
    ...errorResponses({ notFound: false }),
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
  return c.json({ approvals: rows.map(serializeApproval) }, 200);
});

function encodeCursor(cursor: RecordCursor): string {
  return `${cursor.createdAt.getTime()}_${cursor.id}`;
}

function decodeCursor(value: string | undefined): RecordCursor | undefined {
  const match = value?.match(/^(\d+)_([0-9a-f-]{36})$/);
  if (!match?.[1] || !match[2]) return undefined;
  return { createdAt: new Date(Number(match[1])), id: match[2] };
}

const recordRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/agent/approvals-record",
  tags: ["Agent"],
  operationId: "listOrgAgentApprovals",
  summary: "List every member's platform-agent approval requests, for org owners",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      status: agentApprovalStatusSchema.optional(),
      userId: z.string().optional(),
      before: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "One page of the org's approval requests, newest first",
      content: {
        "application/json": {
          schema: z.object({
            approvals: z.array(approvalSchema),
            nextBefore: z.string().nullable(),
          }),
        },
      },
    },
    ...errorResponses({ notFound: false }),
  },
});

agentApprovalsRoutes.openapi(recordRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { limit, status, userId, before } = c.req.valid("query");
  // No apiKeyScope, on purpose: this holds text from members' private chats, so it
  // takes a signed-in owner and no API key reaches it.
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "owner");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const { rows, next } = await listOrgApprovals(c.var.db, orgId, {
    limit,
    status,
    userId,
    before: decodeCursor(before),
  });
  return c.json(
    {
      approvals: rows.map(serializeApproval),
      nextBefore: next ? encodeCursor(next) : null,
    },
    200,
  );
});

const getRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/agent/approvals/{id}",
  tags: ["Agent"],
  operationId: "getAgentApproval",
  summary: "Get one of the caller's platform-agent approval requests",
  request: { params: z.object({ orgId: z.string().uuid(), id: z.string().uuid() }) },
  responses: {
    200: {
      description: "The request, for a card older than the list reaches",
      content: { "application/json": { schema: z.object({ approval: approvalSchema }) } },
    },
    ...errorResponses(),
  },
});

agentApprovalsRoutes.openapi(getRoute, async (c) => {
  const { orgId, id } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const userId = access.actorId;
  if (!userId) return c.json({ error: "Not found" }, 404);

  const row = await getApproval(c.var.db, orgId, userId, id);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ approval: serializeApproval(row) }, 200);
});

const decideRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/agent/approvals/{id}",
  tags: ["Agent"],
  operationId: "decideAgentApproval",
  summary: "Approve and run, or deny, a pending request, or revoke an approval that hasn't run",
  request: {
    params: z.object({ orgId: z.string().uuid(), id: z.string().uuid() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ status: z.enum(["approved", "denied", "revoked"]) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Decided",
      content: {
        "application/json": {
          schema: z.object({
            ok: z.boolean(),
            status: agentApprovalStatusSchema,
            reason: z.string().nullable(),
          }),
        },
      },
    },
    ...errorResponses(),
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

  if (status === "approved") {
    // Approving runs it. A row already approved got here because its run failed, so
    // this is the retry. The action happens under the editor check above.
    const decided = await decideApproval(c.var.db, { orgId, userId, id, status });
    const row = decided ?? (await getApproval(c.var.db, orgId, userId, id));
    if (!row || effectiveStatus(row) !== "approved") return c.json({ error: "Not found" }, 404);

    let finished: Awaited<ReturnType<typeof executeApproval>>;
    try {
      finished = await executeApproval(c.var.db, { orgId, userId, id }, (r) =>
        runApprovedAction(c.var.db, r),
      );
    } catch (err) {
      console.error("approved action failed", err);
      return c.json(
        { error: "The action failed before it finished. Nothing was recorded as run." },
        500,
      );
    }
    if (!finished) return c.json({ error: "Not found" }, 404);
    await noteInChat(c, finished);
    return c.json({ ok: true, status: finished.status, reason: finished.outcomeReason }, 200);
  }

  const row =
    status === "revoked"
      ? await revokeApproval(c.var.db, { orgId, userId, id })
      : await decideApproval(c.var.db, { orgId, userId, id, status });
  if (!row) return c.json({ error: "Not found" }, 404);
  await noteInChat(c, row);
  return c.json({ ok: true, status: row.status, reason: null }, 200);
});
