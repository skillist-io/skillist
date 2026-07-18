import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env } from "../env";

export const realtimeRoutes = new OpenAPIHono<{ Bindings: Env }>();

const wsRoute = createRoute({
  method: "get",
  path: "/realtime/skills/{org}/{repo}",
  tags: ["Realtime"],
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: { 101: { description: "WebSocket upgrade" } },
});

realtimeRoutes.openapi(wsRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const id = c.env.SKILL_HUB.idFromName(`${org}:${repo}`);
  const stub = c.env.SKILL_HUB.get(id);
  return stub.fetch("http://internal/ws", c.req.raw);
});

const sseRoute = createRoute({
  method: "get",
  path: "/events/skills/{org}/{repo}",
  tags: ["Realtime"],
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: { 200: { description: "SSE stream" } },
});

realtimeRoutes.openapi(sseRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const id = c.env.SKILL_HUB.idFromName(`${org}:${repo}`);
  const stub = c.env.SKILL_HUB.get(id);
  return stub.fetch("http://internal/sse", c.req.raw);
});
