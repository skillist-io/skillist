import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { skillFailurePatterns, skills } from "@skillist/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { errorResponses } from "../../lib/openapi";
import { requireOrgAccess } from "../../lib/org-access";
import type { AppEnv } from "./shared";

export const failurePatternsRoutes = new OpenAPIHono<AppEnv>();

const listRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/failure-patterns",
  tags: ["Governance"],
  operationId: "listFailurePatterns",
  summary: "List mined recurring failure patterns for an organization's skills",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({
      status: z.enum(["open", "drafted", "dismissed"]).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            patterns: z.array(
              z.object({
                id: z.string().uuid(),
                skillRepo: z.string(),
                orgSlug: z.string(),
                summary: z.string(),
                suggestedFix: z.string().nullable(),
                occurrences: z.number(),
                status: z.enum(["open", "drafted", "dismissed"]),
                // Set once an agent-drafted feedback row is opened for this pattern.
                feedbackId: z.string().uuid().nullable(),
                updatedAt: z.string(),
              }),
            ),
          }),
        },
      },
      description: "Recurring skill-run/eval failure patterns mined for this org",
    },
    ...errorResponses({ notFound: false }),
  },
});

/**
 * Recurring execution/eval failure patterns the mining workflow has clustered
 * for this org's skills (most frequent first). Each carries an AI summary +
 * suggested fix and, once opened, the `feedbackId` of the agent-drafted
 * improvement awaiting human approval.
 */
failurePatternsRoutes.openapi(listRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { status } = c.req.valid("query");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const where = status
    ? and(eq(skills.orgId, orgId), eq(skillFailurePatterns.status, status))
    : eq(skills.orgId, orgId);

  const rows = await c.var.db
    .select({
      id: skillFailurePatterns.id,
      skillRepo: skillFailurePatterns.skillRepo,
      orgSlug: skillFailurePatterns.orgSlug,
      summary: skillFailurePatterns.summary,
      suggestedFix: skillFailurePatterns.suggestedFix,
      occurrences: skillFailurePatterns.occurrences,
      status: skillFailurePatterns.status,
      feedbackId: skillFailurePatterns.feedbackId,
      updatedAt: skillFailurePatterns.updatedAt,
    })
    .from(skillFailurePatterns)
    .innerJoin(skills, eq(skills.id, skillFailurePatterns.skillId))
    .where(where)
    .orderBy(desc(skillFailurePatterns.occurrences), desc(skillFailurePatterns.updatedAt))
    .limit(100);

  return c.json({ patterns: rows }, 200);
});
