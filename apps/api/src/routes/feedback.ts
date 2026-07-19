import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  approveFeedbackSchema,
  rejectFeedbackSchema,
  submitFeedbackSchema,
} from "@skillist/contracts";
import { aiJobs, approvals, feedback, skills, skillVersions } from "@skillist/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { AiJobMessage, Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { requireOrgAccess, requireOrgRole } from "../lib/org-access";
import { resolveUserId } from "../lib/session";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const feedbackRoutes = new OpenAPIHono<AppEnv>();

const submitFeedbackRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/skills/{repo}/feedback",
  tags: ["Feedback"],
  request: {
    params: z.object({ orgId: z.string().uuid(), repo: z.string() }),
    body: {
      content: { "application/json": { schema: submitFeedbackSchema } },
    },
  },
  responses: { 201: { description: "Feedback submitted" } },
});

feedbackRoutes.openapi(submitFeedbackRoute, async (c) => {
  const userId = await resolveUserId(c);
  const auth = c.var.auth;
  const { orgId, repo } = c.req.valid("param");

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
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
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
  path: "/orgs/{orgId}/skills/{repo}/feedback",
  tags: ["Feedback"],
  request: {
    params: z.object({ orgId: z.string().uuid(), repo: z.string() }),
    query: z.object({
      status: z.enum(["pending", "approved", "rejected"]).optional(),
    }),
  },
  responses: { 200: { description: "Feedback list" } },
});

feedbackRoutes.openapi(listFeedbackRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId, repo } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
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
    )
    .orderBy(desc(feedback.createdAt));

  const enriched = await Promise.all(
    rows.map(async (row) => {
      const [job] = await c.var.db
        .select({
          id: aiJobs.id,
          status: aiJobs.status,
          resultDraftVersionId: aiJobs.resultDraftVersionId,
          error: aiJobs.error,
          completedAt: aiJobs.completedAt,
        })
        .from(aiJobs)
        .where(eq(aiJobs.feedbackId, row.id))
        .orderBy(desc(aiJobs.createdAt))
        .limit(1);

      let draftSemver: string | null = null;
      if (job?.resultDraftVersionId) {
        const [draft] = await c.var.db
          .select({ semver: skillVersions.semver })
          .from(skillVersions)
          .where(eq(skillVersions.id, job.resultDraftVersionId))
          .limit(1);
        draftSemver = draft?.semver ?? null;
      }

      return {
        ...row,
        aiJob: job
          ? {
              ...job,
              draftSemver,
            }
          : null,
      };
    }),
  );

  return c.json(enriched, 200);
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

  const [item] = await c.var.db.select().from(feedback).where(eq(feedback.id, id)).limit(1);
  if (!item) return c.json({ error: "Not found" }, 404);

  const [skill] = await c.var.db.select().from(skills).where(eq(skills.id, item.skillId)).limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const access = await requireOrgRole(c.var.db, skill.orgId, userId, "editor");
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
      type: "feedback",
      jobId: job!.id,
      feedbackId: id,
      skillId: skill.id,
      orgSlug: org?.slug ?? "",
      skillRepo: skill.repo,
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

  const [item] = await c.var.db.select().from(feedback).where(eq(feedback.id, id)).limit(1);
  if (!item) return c.json({ error: "Not found" }, 404);

  const [skill] = await c.var.db.select().from(skills).where(eq(skills.id, item.skillId)).limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const access = await requireOrgRole(c.var.db, skill.orgId, userId, "editor");
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

  const [item] = await c.var.db.select().from(feedback).where(eq(feedback.id, id)).limit(1);
  if (!item) return c.json({ error: "Not found" }, 404);

  const [skill] = await c.var.db.select().from(skills).where(eq(skills.id, item.skillId)).limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  // Only an editor of the owning org may spend AI credits / write a draft
  // version against this skill (mirrors approve/reject above).
  const access = await requireOrgRole(c.var.db, skill.orgId, userId, "editor");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [job] = await c.var.db
    .insert(aiJobs)
    .values({ feedbackId: id, status: "queued" })
    .returning();

  const { organizations } = await import("@skillist/db/schema");
  const [org] = await c.var.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, skill.orgId))
    .limit(1);

  const message: AiJobMessage = {
    type: "feedback",
    jobId: job!.id,
    feedbackId: id,
    skillId: skill.id,
    orgSlug: org?.slug ?? "",
    skillRepo: skill.repo,
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
  const [job] = await c.var.db.select().from(aiJobs).where(eq(aiJobs.id, id)).limit(1);
  if (!job) return c.json({ error: "Not found" }, 404);

  // Scope the job to a caller who can view the owning org: job -> feedback -> skill -> org.
  const [item] = job.feedbackId
    ? await c.var.db.select().from(feedback).where(eq(feedback.id, job.feedbackId)).limit(1)
    : [undefined];
  const [skill] = item
    ? await c.var.db.select().from(skills).where(eq(skills.id, item.skillId)).limit(1)
    : [undefined];
  if (!skill) return c.json({ error: "Not found" }, 404);
  const access = await requireOrgRole(c.var.db, skill.orgId, userId, "viewer");
  if (!access.ok) return c.json({ error: "Not found" }, 404);

  return c.json(job, 200);
});
