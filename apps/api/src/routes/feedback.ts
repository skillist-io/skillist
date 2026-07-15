// @ts-nocheck
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import {
  approveFeedbackSchema,
  rejectFeedbackSchema,
  submitFeedbackSchema,
} from "@skillist/contracts";
import {
  aiJobs,
  approvals,
  feedback,
  skills,
} from "@skillist/db/schema";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import { requireOrgRole, requireOrgAccess } from "../lib/org-access";
import type { WorkerDb } from "../lib/db";
import { resolveUserId } from "../lib/session";
import type { AiJobMessage } from "../env";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const feedbackRoutes = new OpenAPIHono<AppEnv>();

const submitFeedbackRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/skills/{slug}/feedback",
  tags: ["Feedback"],
  request: {
    params: z.object({ orgId: z.string().uuid(), slug: z.string() }),
    body: {
      content: { "application/json": { schema: submitFeedbackSchema } },
    },
  },
  responses: { 201: { description: "Feedback submitted" } },
});

feedbackRoutes.openapi(submitFeedbackRoute, async (c) => {
  const userId = await resolveUserId(c);
  const auth = c.var.auth;
  const { orgId, slug } = c.req.valid("param");

  if (!userId && !auth.apiKeyId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (auth.apiKeyId && !auth.apiKeyScopes.includes("feedback:submit")) {
    return c.json({ error: "Insufficient scope" }, 403);
  }

  const access = auth.apiKeyId
    ? await requireOrgAccess(c.var.db, orgId, auth, "editor", {
        apiKeyScope: "feedback:submit",
      })
    : userId
      ? await requireOrgRole(c.var.db, orgId, userId, "editor")
      : { ok: false as const, status: 401 as const };
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.slug, slug)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const body = c.req.valid("json");
  const [row] = await c.var.db
    .insert(feedback)
    .values({
      skillId: skill.id,
      targetVersionId: body.targetVersionId,
      source: auth.apiKeyId ? "agent" : "human",
      body: body.body,
      suggestedPatch: body.suggestedPatch,
      submittedBy: userId,
      apiKeyId: auth.apiKeyId,
    })
    .returning();

  return c.json(row, 201);
});

const listFeedbackRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/skills/{slug}/feedback",
  tags: ["Feedback"],
  request: {
    params: z.object({ orgId: z.string().uuid(), slug: z.string() }),
    query: z.object({
      status: z.enum(["pending", "approved", "rejected"]).optional(),
    }),
  },
  responses: { 200: { description: "Feedback list" } },
});

feedbackRoutes.openapi(listFeedbackRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId, slug } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.slug, slug)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const { status } = c.req.valid("query");
  const rows = await c.var.db
    .select()
    .from(feedback)
    .where(
      status
        ? and(eq(feedback.skillId, skill.id), eq(feedback.status, status))
        : eq(feedback.skillId, skill.id),
    );
  return c.json(rows, 200);
});

const approveRoute = createRoute({
  method: "post",
  path: "/feedback/{id}/approve",
  tags: ["Feedback"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: { "application/json": { schema: approveFeedbackSchema } },
    },
  },
  responses: { 200: { description: "Approved" } },
});

feedbackRoutes.openapi(approveRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const [item] = await c.var.db
    .select()
    .from(feedback)
    .where(eq(feedback.id, id))
    .limit(1);
  if (!item) return c.json({ error: "Not found" }, 404);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(eq(skills.id, item.skillId))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const access = await requireOrgRole(
    c.var.db,
    skill.orgId,
    userId,
    "editor",
  );
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  await c.var.db
    .update(feedback)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(feedback.id, id));

  await c.var.db.insert(approvals).values({
    feedbackId: id,
    approvedBy: userId,
    comment: body.comment,
  });

  if (body.triggerAi) {
    const [job] = await c.var.db
      .insert(aiJobs)
      .values({ feedbackId: id, status: "queued", model: "llama-3.1-8b" })
      .returning();

    const { organizations } = await import("@skillist/db/schema");
    const [org] = await c.var.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, skill.orgId))
      .limit(1);

    const message: AiJobMessage = {
      jobId: job!.id,
      feedbackId: id,
      skillId: skill.id,
      orgSlug: org?.slug ?? "",
      skillSlug: skill.slug,
    };
    await c.env.AI_QUEUE.send(message);
  }

  return c.json({ ok: true }, 200);
});

const rejectRoute = createRoute({
  method: "post",
  path: "/feedback/{id}/reject",
  tags: ["Feedback"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: { "application/json": { schema: rejectFeedbackSchema } },
    },
  },
  responses: { 200: { description: "Rejected" } },
});

feedbackRoutes.openapi(rejectRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const { id } = c.req.valid("param");

  const [item] = await c.var.db
    .select()
    .from(feedback)
    .where(eq(feedback.id, id))
    .limit(1);
  if (!item) return c.json({ error: "Not found" }, 404);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(eq(skills.id, item.skillId))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const access = await requireOrgRole(
    c.var.db,
    skill.orgId,
    userId,
    "editor",
  );
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  await c.var.db
    .update(feedback)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(feedback.id, id));

  return c.json({ ok: true }, 200);
});

const suggestRoute = createRoute({
  method: "post",
  path: "/feedback/{id}/suggest",
  tags: ["AI"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 202: { description: "AI job queued" } },
});

feedbackRoutes.openapi(suggestRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const { id } = c.req.valid("param");

  const [item] = await c.var.db
    .select()
    .from(feedback)
    .where(eq(feedback.id, id))
    .limit(1);
  if (!item) return c.json({ error: "Not found" }, 404);

  const [job] = await c.var.db
    .insert(aiJobs)
    .values({ feedbackId: id, status: "queued" })
    .returning();

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(eq(skills.id, item.skillId))
    .limit(1);

  const { organizations } = await import("@skillist/db/schema");
  const [org] = skill
    ? await c.var.db
        .select()
        .from(organizations)
        .where(eq(organizations.id, skill.orgId))
        .limit(1)
    : [null];

  const message: AiJobMessage = {
    jobId: job!.id,
    feedbackId: id,
    skillId: item.skillId,
    orgSlug: org?.slug ?? "",
    skillSlug: skill?.slug ?? "",
  };
  await c.env.AI_QUEUE.send(message);

  return c.json({ jobId: job!.id }, 202);
});

const getAiJobRoute = createRoute({
  method: "get",
  path: "/ai-jobs/{id}",
  tags: ["AI"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: { 200: { description: "AI job status" } },
});

feedbackRoutes.openapi(getAiJobRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const { id } = c.req.valid("param");
  const [job] = await c.var.db
    .select()
    .from(aiJobs)
    .where(eq(aiJobs.id, id))
    .limit(1);
  if (!job) return c.json({ error: "Not found" }, 404);
  return c.json(job, 200);
});
