import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import type { SyncQueueMessage } from "@skillist/contracts";
import { routeAgentRequest } from "agents";
import { oAuthDiscoveryMetadata, oAuthProtectedResourceMetadata } from "better-auth/plugins";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { SkillRealtimeHub } from "./durable-objects/skill-realtime-hub";
import type { AiJobMessage, Env } from "./env";
import { runAiJob } from "./lib/ai";
import { createApiAuth, createApiEmailSender } from "./lib/api-auth";
import { authMiddleware } from "./lib/auth-middleware";
import { assertProductionBindings, createWorkerDb } from "./lib/db";
import { handleSyncQueueMessage } from "./lib/github-sync/queue-handler";
import { getOrgMembership } from "./lib/org-access";
import { rateLimit } from "./lib/rate-limit";
import { resolveSessionUserId } from "./lib/session";
import { handleMcpRequest } from "./mcp/handler";
import { mcpServerInfo } from "./mcp/registry-server";
import { deliveryRoutes } from "./routes/delivery";
import { executionRoutes } from "./routes/execution";
import { feedbackRoutes } from "./routes/feedback";
import { governanceRoutes } from "./routes/governance";
import { orgRoutes } from "./routes/orgs";
import { projectRoutes } from "./routes/projects";
import { realtimeRoutes } from "./routes/realtime";
import { registryRoutes } from "./routes/registry";
import { skillRoutes } from "./routes/skills";
import { sourcesRoutes } from "./routes/sources";
import { webhookRoutes } from "./routes/webhooks";

export { Sandbox } from "@cloudflare/sandbox";
export { SkillistAgent } from "./agent/skillist-agent";
export { SandboxHeavy } from "./durable-objects/sandbox-heavy";
export { FailureMiningWorkflow } from "./workflows/failure-mining";
export { SyncSourceWorkflow } from "./workflows/sync-source";
export { SkillRealtimeHub };

const app = new OpenAPIHono<{ Bindings: Env }>();

// Fail loud on production config drift (missing cache-disabled Hyperdrive /
// distributed rate limiter) before handling any request.
app.use("*", async (c, next) => {
  assertProductionBindings(c.env);
  await next();
});

// Security response headers (HSTS, nosniff, frame-ancestors, etc.) on every
// response. No CSP by default — the API is JSON + the Scalar docs page.
app.use("*", secureHeaders());

// Cap request bodies. Skill bundles are the largest legitimate payload; per-file
// and file-count limits live in the Zod schema, this is the outer ceiling.
app.use(
  "*",
  bodyLimit({
    maxSize: 25 * 1024 * 1024,
    onError: (c) => c.json({ error: "Payload too large" }, 413),
  }),
);

// Global error handler: log a correlation id (CF ray) with the failure and
// return a sanitized body instead of leaking a stack trace via Hono's default.
app.onError((err, c) => {
  const correlationId = c.req.header("cf-ray") ?? crypto.randomUUID();
  console.error(
    JSON.stringify({
      msg: "unhandled_error",
      correlationId,
      method: c.req.method,
      path: c.req.path,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  return c.json({ error: "Internal Server Error", correlationId }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.use(
  "/mcp",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Accept", "Authorization", "Mcp-Session-Id"],
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
      "https://skillist.io",
      "https://api.skillist.io",
      // Console opens the platform agent WebSocket/RPC cross-subdomain; cookies
      // are already scoped to .skillist.io so the session rides along.
      "https://console.skillist.io",
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
    /^\/[^/]+\/[^/]+\/(scripts|run|runs)(\/|$)/.test(path) || path.startsWith("/runs/");
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

// Platform agent (Cloudflare Agents SDK). Auth-gated on the Better Auth session
// and org membership before `routeAgentRequest` resolves the DO. The instance
// name is the orgId (`/agents/skillist-agent/{orgId}`), so the verified uid is
// injected as a query param the client can't spoof — we delete any client value
// first.
app.all("/agents/*", async (c) => {
  const url = new URL(c.req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ["agents", "{class}", "{orgId}", ...]
  const orgId = parts[2];
  if (!orgId) return c.json({ error: "Missing agent instance" }, 400);

  const db = createWorkerDb(c.env);
  const userId = await resolveSessionUserId(db, c.env, c.req.raw.headers);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const membership = await getOrgMembership(db, orgId, userId);
  if (!membership) return c.json({ error: "Forbidden" }, 403);

  url.searchParams.delete("uid");
  url.searchParams.set("uid", userId);
  const res = await routeAgentRequest(new Request(url.toString(), c.req.raw), c.env);
  return res ?? c.notFound();
});

const v1 = new OpenAPIHono<{ Bindings: Env }>();
v1.route("/", orgRoutes);
v1.route("/", skillRoutes);
v1.route("/", projectRoutes);
v1.route("/", registryRoutes);
v1.route("/", feedbackRoutes);
v1.route("/", governanceRoutes);
v1.route("/", realtimeRoutes);
v1.route("/", sourcesRoutes);
v1.route("/", webhookRoutes);

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
    { url: "https://api.skillist.io/v1", description: "Production" },
  ],
});

app.get(
  "/docs",
  apiReference({
    url: "/openapi.json",
    pageTitle: "Skillist API",
  }),
);

const SYNC_QUEUE_NAME = "skillist-sync-jobs";

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Daily 06:00 UTC → sync_all; weekly Sunday 07:00 UTC → discover
    const cron = controller.cron;
    if (cron === "0 7 * * sun") {
      ctx.waitUntil(env.SYNC_QUEUE.send({ type: "discover_sources" }));
      return;
    }
    // Every 6h → mine recent execution failures per skill. Pick the skills with
    // the most failed runs in the last 24h (bounded) and kick a durable
    // FailureMiningWorkflow for each.
    if (cron === "0 */6 * * *") {
      const db = createWorkerDb(env);
      const { skillRuns } = await import("@skillist/db/schema");
      const { and, desc, eq, gte, sql } = await import("drizzle-orm");
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rows = await db
        .select({ skillId: skillRuns.skillId })
        .from(skillRuns)
        .where(and(eq(skillRuns.status, "failed"), gte(skillRuns.createdAt, since)))
        .groupBy(skillRuns.skillId)
        .orderBy(desc(sql`count(*)`))
        .limit(25);
      for (const { skillId } of rows) {
        ctx.waitUntil(env.FAILURE_WORKFLOW.create({ params: { skillId } }));
      }
      return;
    }
    ctx.waitUntil(env.SYNC_QUEUE.send({ type: "sync_all" }));
  },

  async queue(batch: MessageBatch<AiJobMessage | SyncQueueMessage>, env: Env): Promise<void> {
    if (batch.queue === SYNC_QUEUE_NAME) {
      for (const message of batch.messages) {
        try {
          await handleSyncQueueMessage(env, message.body as SyncQueueMessage);
          message.ack();
        } catch (err) {
          console.error(
            JSON.stringify({
              msg: "sync_queue_error",
              error: err instanceof Error ? err.message : String(err),
              body: message.body,
            }),
          );
          message.retry();
        }
      }
      return;
    }

    const db = createWorkerDb(env);
    for (const message of batch.messages) {
      const body = message.body as AiJobMessage;
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
      await db.update(aiJobs).set({ status: "running" }).where(eq(aiJobs.id, jobId));
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
