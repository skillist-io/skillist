import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { computeCoverage } from "../../lib/coverage";
import { requireOrgAccess } from "../../lib/org-access";
import type { AppEnv } from "./shared";

export const coverageRoutes = new OpenAPIHono<AppEnv>();

const coverageRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/coverage",
  tags: ["Governance"],
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: {
    200: { description: "Required-skill coverage across the three layers" },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

/**
 * Required-skill coverage across the three layers (published → covered →
 * activated) plus drift. The computation lives in `lib/coverage.ts` so the
 * platform agent's `get_coverage` tool can reuse it without duplicating SQL.
 */
coverageRoutes.openapi(coverageRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const result = await computeCoverage(c.var.db, orgId);
  return c.json(result, 200);
});
