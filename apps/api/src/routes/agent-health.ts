import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env } from "../env";
import { checkAgentModel } from "../lib/agent/model-health";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { errorResponses } from "../lib/openapi";
// requireDocsAdmin is the platform-admin gate (SKILLIST_ADMIN_USER_IDS, session
// or admin API key) — not docs-specific despite the name.
import { requireDocsAdmin } from "./admin-docs";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const agentHealthRoutes = new OpenAPIHono<AppEnv>();

const healthSchema = z.object({
  provider: z.enum(["anthropic", "workers-ai"]),
  model: z.string(),
  configured: z.boolean(),
  ok: z.boolean(),
  status: z.number().nullable(),
  error: z.string().nullable(),
});

const healthRoute = createRoute({
  method: "get",
  path: "/admin/agent-health",
  tags: ["Admin"],
  operationId: "getAgentHealth",
  summary: "Whether the platform agent's configured model authenticates (spends no tokens)",
  responses: {
    200: {
      description: "Agent model status — `ok:false` flags a bad/expired Anthropic key.",
      content: { "application/json": { schema: healthSchema } },
    },
    ...errorResponses({ validates: false, notFound: false }),
  },
});

agentHealthRoutes.openapi(healthRoute, async (c) => {
  const gate = requireDocsAdmin(c.env, c.var.auth);
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const health = await checkAgentModel(c.env);
  return c.json(health, 200);
});
