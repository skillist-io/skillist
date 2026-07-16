import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import {
  oAuthDiscoveryMetadata,
  oAuthProtectedResourceMetadata,
} from "better-auth/plugins";
import type { Env, AiJobMessage } from "./env";
import { authMiddleware } from "./lib/auth-middleware";
import { createApiAuth, createApiEmailSender } from "./lib/api-auth";
import { createWorkerDb } from "./lib/db";
import { runAiJob } from "./lib/ai";
import { orgRoutes } from "./routes/orgs";
import { skillRoutes } from "./routes/skills";
import { registryRoutes } from "./routes/registry";
import { feedbackRoutes } from "./routes/feedback";
import { realtimeRoutes } from "./routes/realtime";
import { governanceRoutes } from "./routes/governance";
import { executionRoutes } from "./routes/execution";
import { deliveryRoutes } from "./routes/delivery";
import { rateLimit } from "./lib/rate-limit";
import { SkillRealtimeHub } from "./durable-objects/skill-realtime-hub";
import { handleMcpRequest } from "./mcp/handler";
import { mcpServerInfo } from "./mcp/registry-server";

export { SkillRealtimeHub };
export { Sandbox } from "@cloudflare/sandbox";
export { SandboxHeavy } from "./durable-objects/sandbox-heavy";

const app = new OpenAPIHono<{ Bindings: Env }>();

app.use(
  "/mcp",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Accept",
      "Authorization",
      "Mcp-Session-Id",
    ],
    exposeHeaders: ["Mcp-Session-Id", "WWW-Authenticate"],
  }),
);
app.all("/mcp", handleMcpRequest);
app.options("/mcp", (c) => c.body(null, 204));

app.get("/.well-known/oauth-authorization-server", async (c) => {
  const auth = createApiAuth(c.env, createApiEmailSender(c.env));
  return oAuthDiscoveryMetadata(auth)(c.req.raw);
});

app.get("/.well-known/oauth-protected-resource", async (c) => {
  const auth = createApiAuth(c.env, createApiEmailSender(c.env));
  return oAuthProtectedResourceMetadata(auth)(c.req.raw);
});

app.use(
  "*",
  cors({
    origin: [
      "http://localhost:5173",
      "https://skillist.dev",
      "https://api.skillist.dev",
    ],
    credentials: true,
  }),
);

app.use("/v1/*", rateLimit());
app.use("/v1/*", authMiddleware);

// Apex execution paths need auth (delivery SKILL.md/meta/bundle stay public)
app.use("*", async (c, next) => {
  const path = c.req.path;
  const needsAuth =
    /^\/[^/]+\/[^/]+\/(scripts|run|runs)(\/|$)/.test(path) ||
    path.startsWith("/runs/");
  if (!needsAuth) {
    await next();
    return;
  }
  await rateLimit()(c, async () => {
    await authMiddleware(c as never, next);
  });
});

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "skillist-api",
    ts: Date.now(),
    mcp: mcpServerInfo(c.env.BETTER_AUTH_URL),
    auth: {
      github: Boolean(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET),
      google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
      mcpOAuth: true,
    },
  }),
);

// Better Auth handler
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const auth = createApiAuth(c.env, createApiEmailSender(c.env));
  return auth.handler(c.req.raw);
});

const v1 = new OpenAPIHono<{ Bindings: Env }>();
v1.route("/", orgRoutes);
v1.route("/", skillRoutes);
v1.route("/", registryRoutes);
v1.route("/", feedbackRoutes);
v1.route("/", governanceRoutes);
v1.route("/", realtimeRoutes);

app.route("/v1", v1);

// GitHub-style public delivery + execution on apex paths
app.route("/", deliveryRoutes);
app.route("/", executionRoutes);

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Skillist API",
    version: "1.0.0",
    description:
      "Realtime Agent Skills management, versioning, and delivery API. Compliant with agentskills.io.",
  },
  servers: [
    { url: "http://localhost:8787/v1", description: "Local" },
    { url: "https://api.skillist.dev/v1", description: "Production" },
  ],
});

app.get(
  "/docs",
  apiReference({
    url: "/openapi.json",
    pageTitle: "Skillist API",
  }),
);

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<AiJobMessage>, env: Env): Promise<void> {
    const db = createWorkerDb(env);
    for (const message of batch.messages) {
      const body = message.body;
      if (body.type === "eval") {
        const { skillEvals } = await import("@skillist/db/schema");
        const { eq } = await import("drizzle-orm");
        const { runSkillEval } = await import("./lib/eval");
        await db
          .update(skillEvals)
          .set({ status: "running" })
          .where(eq(skillEvals.id, body.evalId));
        try {
          await runSkillEval(env, db, body.evalId);
          message.ack();
        } catch (err) {
          await db
            .update(skillEvals)
            .set({
              status: "failed",
              error: err instanceof Error ? err.message : "Unknown error",
            })
            .where(eq(skillEvals.id, body.evalId));
          message.retry();
        }
        continue;
      }

      const { jobId, feedbackId } = body;
      const { aiJobs } = await import("@skillist/db/schema");
      const { eq } = await import("drizzle-orm");
      await db
        .update(aiJobs)
        .set({ status: "running" })
        .where(eq(aiJobs.id, jobId));
      try {
        await runAiJob(env, db, jobId, feedbackId);
        message.ack();
      } catch (err) {
        await db
          .update(aiJobs)
          .set({
            status: "failed",
            error: err instanceof Error ? err.message : "Unknown error",
            completedAt: new Date(),
          })
          .where(eq(aiJobs.id, jobId));
        message.retry();
      }
    }
  },
};
