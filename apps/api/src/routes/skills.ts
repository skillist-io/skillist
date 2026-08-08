import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createSkillSchema, uploadVersionSchema } from "@skillist/contracts";
import { organizations, skillFiles, skills, skillVersions } from "@skillist/db/schema";
import {
  compareSemver,
  createSkillTemplate,
  estimateImpactScore,
  objectToBundle,
  resolveNextSemver,
  reviewSkillBundle,
  scanSkillSecurity,
  validateSkillBundle,
} from "@skillist/skill-format";
import { and, eq } from "drizzle-orm";
import type { Env } from "../env";
import { publishVersion, rollbackVersion } from "../lib/ai";
import type { AuthContext } from "../lib/auth-middleware";
import { isUniqueViolation, type WorkerDb } from "../lib/db";
import { isDatabaseError } from "../lib/error-detail";
import { errorResponses } from "../lib/openapi";
import { requireOrgAccess } from "../lib/org-access";
import { queueSkillEval } from "../lib/queue-eval";
import {
  deleteBundleFromR2,
  downloadBundleFromR2,
  listBundlePaths,
  r2Prefix,
  sha256,
  uploadBundleToR2,
} from "../lib/r2";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const skillRoutes = new OpenAPIHono<AppEnv>();

const jsonError = (description: string) => ({
  content: { "application/json": { schema: z.object({ error: z.any() }) } },
  description,
});

/** A finding from `scanSkillSecurity` (skill-format). */
const securityIssueSchema = z.object({
  severity: z.string(),
  path: z.string(),
  message: z.string(),
  ruleId: z.string().optional(),
});

/**
 * A scored check from `reviewSkillBundle`. `weight` is present on live review
 * output but absent from the rows persisted before weighting was introduced,
 * hence optional.
 */
const reviewCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  passed: z.boolean(),
  message: z.string(),
  weight: z.number().optional(),
});

/** A row of `skill_versions`; timestamps serialize to ISO strings. */
const skillVersionSchema = z.object({
  id: z.string().uuid(),
  skillId: z.string().uuid(),
  status: z.string(),
  semver: z.string(),
  r2Prefix: z.string(),
  kvEtag: z.string().nullable(),
  qualityScore: z.number().nullable(),
  impactScore: z.number().nullable(),
  securityStatus: z.string().nullable(),
  securityIssues: z.array(securityIssueSchema).nullable(),
  reviewChecks: z.array(reviewCheckSchema).nullable(),
  // Untyped jsonb: shape follows whatever plugin manifest the bundle shipped.
  pluginManifest: z.unknown(),
  parentVersionId: z.string().uuid().nullable(),
  createdBy: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});

/** Publish and rollback both resolve the same delivery-state summary. */
const publishResultSchema = z.object({
  etag: z.string(),
  version: z.string(),
  qualityScore: z.number(),
  impactScore: z.number(),
  securityStatus: z.string(),
});

const createSkillRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/skills",
  tags: ["Skills"],
  operationId: "createSkill",
  summary: "Create a skill from the starter template",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    body: { content: { "application/json": { schema: createSkillSchema } } },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().uuid(),
            repo: z.string(),
            visibility: z.string(),
          }),
        },
      },
      description: "Skill created",
    },
    ...errorResponses({ notFound: false }),
    // Bundle validation returns a list of messages, not the plain string envelope.
    400: jsonError("Invalid skill bundle"),
  },
});

skillRoutes.openapi(createSkillRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  // `skillist push` creates a skill on first publish, so an API key has to be
  // able to reach this. An unnamed scope would rate the key as a viewer and 403
  // it — see the note on `requireOrgAccess`.
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "editor", {
    apiKeyScope: "skills:write",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const userId = access.actorId;
  const body = c.req.valid("json");
  const description = body.description ?? `Agent skill: ${body.repo.replace(/-/g, " ")}`;
  const bundle = createSkillTemplate(body.repo, description);
  const validation = validateSkillBundle(bundle, body.repo);
  if (!validation.valid) {
    return c.json({ error: validation.errors }, 400);
  }

  const versionId = crypto.randomUUID();
  const prefix = r2Prefix(orgId, body.repo, versionId);
  await uploadBundleToR2(c.env.SKILLS_R2, prefix, bundle);

  const skillMd = bundle.get("SKILL.md")!;
  const skillMdSha = await sha256(skillMd);

  // Skill + initial version + file rows must land together; if the DB writes
  // fail, delete the R2 objects we just wrote so no orphaned bundle is left.
  let created: { id: string; repo: string; visibility: string };
  try {
    created = await c.var.db.transaction(async (tx) => {
      const [skill] = await tx
        .insert(skills)
        .values({ orgId, repo: body.repo, visibility: body.visibility, description })
        .returning();
      if (!skill) throw new Error("skill insert returned no row");
      await tx.insert(skillVersions).values({
        id: versionId,
        skillId: skill.id,
        status: "draft",
        semver: "0.1.0",
        r2Prefix: prefix,
        createdBy: userId,
      });
      await tx.insert(skillFiles).values({
        versionId,
        path: "SKILL.md",
        sha256: skillMdSha,
        size: skillMd.length,
      });
      return { id: skill.id, repo: skill.repo, visibility: skill.visibility };
    });
  } catch (err) {
    await deleteBundleFromR2(c.env.SKILLS_R2, prefix).catch(() => {});
    throw err;
  }

  return c.json(created, 201);
});

const listSkillsRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/skills",
  tags: ["Skills"],
  operationId: "listSkills",
  summary: "List an organization's skills",
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              id: z.string().uuid(),
              repo: z.string(),
              visibility: z.string(),
              description: z.string().nullable(),
            }),
          ),
        },
      },
      description: "List skills",
    },
    ...errorResponses({ validates: false, notFound: false }),
  },
});

skillRoutes.openapi(listSkillsRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const rows = await c.var.db.select().from(skills).where(eq(skills.orgId, orgId));
  return c.json(rows, 200);
});

const uploadVersionRoute = createRoute({
  method: "put",
  path: "/orgs/{orgId}/skills/{repo}/versions",
  tags: ["Skills"],
  operationId: "uploadSkillVersion",
  summary: "Upload a new draft version of a skill",
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      repo: z.string(),
    }),
    body: {
      content: { "application/json": { schema: uploadVersionSchema } },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().uuid(),
            semver: z.string(),
            status: z.string(),
            // The upload auto-queues an eval (or reuses the in-flight one); the
            // handler has always returned this, it was just undocumented.
            eval: z.object({
              evalId: z.string().uuid(),
              status: z.string(),
              created: z.boolean(),
            }),
          }),
        },
      },
      description: "Version uploaded",
    },
    ...errorResponses({ conflict: true }),
    // Bundle validation returns a list of messages, not the plain string envelope.
    400: jsonError("Invalid skill bundle"),
  },
});

skillRoutes.openapi(uploadVersionRoute, async (c) => {
  const { orgId, repo } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "editor", {
    apiKeyScope: "skills:write",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const userId = access.actorId;

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return c.json({ error: "Skill not found" }, 404);

  const body = c.req.valid("json");
  const bundle = objectToBundle(body.files);
  const validation = validateSkillBundle(bundle, repo);
  if (!validation.valid) {
    return c.json({ error: validation.errors }, 400);
  }

  const parentVersion = body.parentVersionId
    ? await c.var.db
        .select({ semver: skillVersions.semver })
        .from(skillVersions)
        .where(eq(skillVersions.id, body.parentVersionId))
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : null;

  const semver = resolveNextSemver(parentVersion?.semver, {
    semver: body.semver,
    bump: body.bump,
  });

  // Guard against version reuse / going backwards before touching R2. Semver
  // must be unique within a skill, and an explicitly pinned semver must move
  // past the highest existing version (an auto-bump is monotonic already).
  const existingVersions = await c.var.db
    .select({ semver: skillVersions.semver })
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skill.id));
  if (existingVersions.some((v) => v.semver === semver)) {
    return c.json({ error: `Version ${semver} already exists for this skill` }, 409);
  }
  if (body.semver) {
    const highest = existingVersions.reduce<string | null>(
      (max, v) => (max === null || compareSemver(v.semver, max) > 0 ? v.semver : max),
      null,
    );
    if (highest && compareSemver(semver, highest) <= 0) {
      return c.json(
        { error: `Version ${semver} must be greater than the latest version ${highest}` },
        409,
      );
    }
  }

  const versionId = crypto.randomUUID();
  const prefix = r2Prefix(orgId, repo, versionId);
  await uploadBundleToR2(c.env.SKILLS_R2, prefix, bundle);

  // Hash every file in parallel (pure CPU) before opening the transaction.
  const fileRows = await Promise.all(
    [...bundle.entries()].map(async ([path, content]) => ({
      versionId,
      path,
      sha256: await sha256(content),
      size: content.length,
    })),
  );

  // Version + file rows land together; on failure delete the R2 objects we just
  // wrote so a failed upload leaves no orphaned bundle.
  let version: typeof skillVersions.$inferSelect;
  try {
    version = await c.var.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(skillVersions)
        .values({
          id: versionId,
          skillId: skill.id,
          status: "draft",
          semver,
          r2Prefix: prefix,
          parentVersionId: body.parentVersionId,
          createdBy: userId,
        })
        .returning();
      if (!inserted) throw new Error("version insert returned no row");
      if (fileRows.length > 0) {
        await tx.insert(skillFiles).values(fileRows);
      }
      return inserted;
    });
  } catch (err) {
    await deleteBundleFromR2(c.env.SKILLS_R2, prefix).catch(() => {});
    // The read-then-compare above is a fast path, not the guarantee: two
    // concurrent uploads of the same semver can both pass it. The unique index
    // on (skill_id, semver) is what actually enforces uniqueness, so translate
    // its violation into the same 409 rather than surfacing a 500.
    if (isUniqueViolation(err)) {
      return c.json({ error: `Version ${semver} already exists for this skill` }, 409);
    }
    throw err;
  }

  const [org] = await c.var.db
    .select({
      publishPolicy: organizations.publishPolicy,
      slug: organizations.slug,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  const evalQueue = await queueSkillEval(c.env, c.var.db, {
    skillId: skill.id,
    versionId,
    orgSlug: org?.slug ?? orgId,
    skillRepo: repo,
  });

  return c.json(
    {
      id: version.id,
      semver: version.semver,
      status: version.status,
      eval: evalQueue,
    },
    201,
  );
});

const listVersionsRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/skills/{repo}/versions",
  tags: ["Skills"],
  operationId: "listSkillVersions",
  summary: "List every version of a skill",
  request: {
    params: z.object({ orgId: z.string().uuid(), repo: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.array(skillVersionSchema) } },
      description: "Version list",
    },
    ...errorResponses(),
  },
});

skillRoutes.openapi(listVersionsRoute, async (c) => {
  const { orgId, repo } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const versions = await c.var.db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skill.id));
  return c.json(versions, 200);
});

const publishRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/skills/{repo}/versions/{versionId}/publish",
  tags: ["Skills"],
  operationId: "publishSkillVersion",
  summary: "Publish a skill version to the delivery edge",
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      repo: z.string(),
      versionId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: publishResultSchema } },
      description: "Published",
    },
    ...errorResponses(),
  },
});

skillRoutes.openapi(publishRoute, async (c) => {
  const { orgId, repo, versionId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "editor", {
    apiKeyScope: "skills:publish",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const userId = access.actorId;

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  try {
    const result = await publishVersion(
      c.env,
      c.var.db,
      skill.id,
      versionId,
      userId,
      access.actorType,
    );
    return c.json(result, 200);
  } catch (err) {
    // Publish rejections (gate not met, bad version) are the caller's to fix and
    // their message is the useful part. A database failure is not — rethrow so
    // the global handler logs it and answers 500 rather than echoing the SQL.
    if (isDatabaseError(err)) throw err;
    return c.json({ error: err instanceof Error ? err.message : "Publish failed" }, 400);
  }
});

const rollbackRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/skills/{repo}/versions/{versionId}/rollback",
  tags: ["Skills"],
  operationId: "rollbackSkillVersion",
  summary: "Roll the published pointer back to an earlier version",
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      repo: z.string(),
      versionId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: publishResultSchema } },
      description: "Rolled back",
    },
    ...errorResponses(),
  },
});

skillRoutes.openapi(rollbackRoute, async (c) => {
  const { orgId, repo, versionId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "editor", {
    apiKeyScope: "skills:publish",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  try {
    const result = await rollbackVersion(
      c.env,
      c.var.db,
      skill.id,
      versionId,
      access.actorId,
      access.actorType,
    );
    return c.json(result, 200);
  } catch (err) {
    if (isDatabaseError(err)) throw err;
    return c.json({ error: err instanceof Error ? err.message : "Rollback failed" }, 400);
  }
});

const getVersionFilesRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/skills/{repo}/versions/{versionId}/files",
  tags: ["Skills"],
  operationId: "getSkillVersionFiles",
  summary: "Read every file in a skill version's bundle",
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      repo: z.string(),
      versionId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          // Bundle paths are arbitrary, so the map is keyed openly; values are
          // the file contents as text.
          schema: z.object({ files: z.record(z.string(), z.string()) }),
        },
      },
      description: "Version files",
    },
    ...errorResponses(),
  },
});

skillRoutes.openapi(getVersionFilesRoute, async (c) => {
  const { orgId, repo, versionId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const [version] = await c.var.db
    .select()
    .from(skillVersions)
    .where(and(eq(skillVersions.id, versionId), eq(skillVersions.skillId, skill.id)))
    .limit(1);
  if (!version) return c.json({ error: "Not found" }, 404);

  const paths = await listBundlePaths(c.env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(c.env.SKILLS_R2, version.r2Prefix, paths);
  const files: Record<string, string> = {};
  for (const [path, content] of bundle.entries()) {
    files[path] = content;
  }
  return c.json({ files }, 200);
});

const previewVersionRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/skills/{repo}/versions/{versionId}/preview",
  tags: ["Skills"],
  operationId: "previewSkillVersion",
  summary: "Preview review and security findings for a skill version",
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      repo: z.string(),
      versionId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            qualityScore: z.number(),
            impactScore: z.number(),
            securityStatus: z.string(),
            reviewChecks: z.array(reviewCheckSchema),
            securityIssues: z.array(securityIssueSchema),
          }),
        },
      },
      description: "Review and security preview",
    },
    ...errorResponses(),
  },
});

skillRoutes.openapi(previewVersionRoute, async (c) => {
  const { orgId, repo, versionId } = c.req.valid("param");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer", {
    apiKeyScope: "skills:read",
  });
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const [version] = await c.var.db
    .select()
    .from(skillVersions)
    .where(and(eq(skillVersions.id, versionId), eq(skillVersions.skillId, skill.id)))
    .limit(1);
  if (!version) return c.json({ error: "Not found" }, 404);

  const paths = await listBundlePaths(c.env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(c.env.SKILLS_R2, version.r2Prefix, paths);
  const [org] = await c.var.db
    .select({ reviewRubric: organizations.reviewRubric })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const review = reviewSkillBundle(bundle, repo, org?.reviewRubric);
  const impactScore = estimateImpactScore(review);
  const security = scanSkillSecurity(bundle);

  return c.json(
    {
      qualityScore: review.score,
      impactScore,
      securityStatus: security.status,
      reviewChecks: review.checks,
      securityIssues: security.issues,
    },
    200,
  );
});
