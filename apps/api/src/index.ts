import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { createAuth } from "@skillist/auth";
import type { Env, AiJobMessage } from "./env";
import { authMiddleware } from "./lib/auth-middleware";
import { createWorkerDb } from "./lib/db";
import { runAiJob } from "./lib/ai";
import { orgRoutes } from "./routes/orgs";
import { skillRoutes } from "./routes/skills";
import { registryRoutes } from "./routes/registry";
import { feedbackRoutes } from "./routes/feedback";
import { realtimeRoutes } from "./routes/realtime";
import { governanceRoutes } from "./routes/governance";
import { executionRoutes } from "./routes/execution";
import { rateLimit } from "./lib/rate-limit";
import { SkillRealtimeHub } from "./durable-objects/skill-realtime-hub";

export { SkillRealtimeHub };
export { Sandbox } from "@cloudflare/sandbox";

const app = new OpenAPIHono<{ Bindings: Env }>();

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

app.get("/health", (c) =>
  c.json({ status: "ok", service: "skillist-api", ts: Date.now() }),
);

// Better Auth handler
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const db = createWorkerDb(c.env);
  const auth = createAuth(
    db,
    {
      BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
      GITHUB_CLIENT_ID: c.env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: c.env.GITHUB_CLIENT_SECRET,
      GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
    },
    async ({ to, subject, html, text }) => {
      try {
        await c.env.EMAIL.send({
          to,
          from: "welcome@skillist.dev",
          subject,
          html,
          text,
        });
      } catch {
        console.log(`Email to ${to}: ${subject} — ${text}`);
      }
    },
  );
  return auth.handler(c.req.raw);
});

const v1 = new OpenAPIHono<{ Bindings: Env }>();
v1.route("/", orgRoutes);
v1.route("/", skillRoutes);
v1.route("/", registryRoutes);
v1.route("/", feedbackRoutes);
v1.route("/", governanceRoutes);
v1.route("/", executionRoutes);
v1.route("/", realtimeRoutes);

app.route("/v1", v1);

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
