// @ts-nocheck
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import {
  createSkillSchema,
  uploadVersionSchema,
} from "@skillist/contracts";
import {
  organizations,
  skillFiles,
  skillVersions,
  skills,
} from "@skillist/db/schema";
import {
  createSkillTemplate,
  objectToBundle,
  validateSkillBundle,
} from "@skillist/skill-format";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import { requireOrgRole } from "../lib/org-access";
import { publishVersion } from "../lib/ai";
import {
  r2Prefix,
  sha256,
  uploadBundleToR2,
  listBundlePaths,
  downloadBundleFromR2,
} from "../lib/r2";
import { getPublishedSkillMd, getPublishedMeta } from "../lib/publish";
import type { WorkerDb } from "../lib/db";
import { resolveUserId } from "../lib/session";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const skillRoutes = new OpenAPIHono<AppEnv>();

const createSkillRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/skills",
  tags: ["Skills"],
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
            slug: z.string(),
            visibility: z.string(),
          }),
        },
      },
      description: "Skill created",
    },
  },
});

skillRoutes.openapi(createSkillRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "editor");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const body = c.req.valid("json");
  const description =
    body.description ?? `Agent skill: ${body.slug.replace(/-/g, " ")}`;
  const bundle = createSkillTemplate(body.slug, description);
  const validation = validateSkillBundle(bundle, body.slug);
  if (!validation.valid) {
    return c.json({ error: validation.errors }, 400);
  }

  const [skill] = await c.var.db
    .insert(skills)
    .values({
      orgId,
      slug: body.slug,
      visibility: body.visibility,
      description,
    })
    .returning();
  if (!skill) return c.json({ error: "Failed" }, 500);

  const versionId = crypto.randomUUID();
  const prefix = r2Prefix(orgId, body.slug, versionId);
  await uploadBundleToR2(c.env.SKILLS_R2, prefix, bundle);

  await c.var.db.insert(skillVersions).values({
    id: versionId,
    skillId: skill.id,
    status: "draft",
    semver: "0.1.0",
    r2Prefix: prefix,
    createdBy: userId,
  });

  const skillMd = bundle.get("SKILL.md")!;
  await c.var.db.insert(skillFiles).values({
    versionId,
    path: "SKILL.md",
    sha256: await sha256(skillMd),
    size: skillMd.length,
  });

  return c.json(
    { id: skill.id, slug: skill.slug, visibility: skill.visibility },
    201,
  );
});

const listSkillsRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/skills",
  tags: ["Skills"],
  request: { params: z.object({ orgId: z.string().uuid() }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              id: z.string().uuid(),
              slug: z.string(),
              visibility: z.string(),
              description: z.string().nullable(),
            }),
          ),
        },
      },
      description: "List skills",
    },
  },
});

skillRoutes.openapi(listSkillsRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);
  const rows = await c.var.db
    .select()
    .from(skills)
    .where(eq(skills.orgId, orgId));
  return c.json(rows, 200);
});

const uploadVersionRoute = createRoute({
  method: "put",
  path: "/orgs/{orgId}/skills/{slug}/versions",
  tags: ["Skills"],
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      slug: z.string(),
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
          }),
        },
      },
      description: "Version uploaded",
    },
  },
});

skillRoutes.openapi(uploadVersionRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId, slug } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "editor");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.slug, slug)))
    .limit(1);
  if (!skill) return c.json({ error: "Skill not found" }, 404);

  const body = c.req.valid("json");
  const bundle = objectToBundle(body.files);
  const validation = validateSkillBundle(bundle, slug);
  if (!validation.valid) {
    return c.json({ error: validation.errors }, 400);
  }

  const versionId = crypto.randomUUID();
  const prefix = r2Prefix(orgId, slug, versionId);
  await uploadBundleToR2(c.env.SKILLS_R2, prefix, bundle);

  const semver = body.semver ?? "0.1.0";
  const [version] = await c.var.db
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

  for (const [path, content] of bundle.entries()) {
    await c.var.db.insert(skillFiles).values({
      versionId,
      path,
      sha256: await sha256(content),
      size: content.length,
    });
  }

  return c.json(
    { id: version!.id, semver: version!.semver, status: version!.status },
    201,
  );
});

const listVersionsRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/skills/{slug}/versions",
  tags: ["Skills"],
  request: {
    params: z.object({ orgId: z.string().uuid(), slug: z.string() }),
  },
  responses: { 200: { description: "Version list" } },
});

skillRoutes.openapi(listVersionsRoute, async (c) => {
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

  const versions = await c.var.db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skill.id));
  return c.json(versions, 200);
});

const publishRoute = createRoute({
  method: "post",
  path: "/orgs/{orgId}/skills/{slug}/versions/{versionId}/publish",
  tags: ["Skills"],
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      slug: z.string(),
      versionId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ etag: z.string(), version: z.string() }),
        },
      },
      description: "Published",
    },
  },
});

skillRoutes.openapi(publishRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId, slug, versionId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "editor");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.slug, slug)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  try {
    const result = await publishVersion(
      c.env,
      c.var.db,
      skill.id,
      versionId,
      userId,
    );
    return c.json(result, 200);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Publish failed" },
      400,
    );
  }
});

const getSkillMdRoute = createRoute({
  method: "get",
  path: "/skills/{org}/{slug}/SKILL.md",
  tags: ["Delivery"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
  },
  responses: { 200: { description: "SKILL.md content" } },
});

skillRoutes.openapi(getSkillMdRoute, async (c) => {
  const { org, slug } = c.req.valid("param");
  const cached = await getPublishedSkillMd(c.env.SKILLS_KV, org, slug);
  if (!cached) return c.json({ error: "Not found" }, 404);
  return new Response(cached.skillMd, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      ETag: cached.meta.etag,
      "Cache-Control": "public, max-age=60",
      "X-Skillist-Version": cached.meta.version,
    },
  });
});

const getSkillMetaRoute = createRoute({
  method: "get",
  path: "/skills/{org}/{slug}/meta",
  tags: ["Delivery"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
  },
  responses: { 200: { description: "Discovery metadata" } },
});

skillRoutes.openapi(getSkillMetaRoute, async (c) => {
  const { org, slug } = c.req.valid("param");
  const meta = await getPublishedMeta(c.env.SKILLS_KV, org, slug);
  if (!meta) return c.json({ error: "Not found" }, 404);
  return c.json(meta, 200);
});

const getBundleRoute = createRoute({
  method: "get",
  path: "/skills/{org}/{slug}/bundle",
  tags: ["Delivery"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
  },
  responses: { 200: { description: "Skill bundle" } },
});

skillRoutes.openapi(getBundleRoute, async (c) => {
  const { org, slug } = c.req.valid("param");
  const [orgRow] = await c.var.db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, org))
    .limit(1);
  if (!orgRow) return c.json({ error: "Not found" }, 404);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgRow.id), eq(skills.slug, slug)))
    .limit(1);
  if (!skill || !skill.latestPublishedVersionId) {
    return c.json({ error: "Not found" }, 404);
  }

  const [version] = await c.var.db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, skill.latestPublishedVersionId))
    .limit(1);
  if (!version) return c.json({ error: "Not found" }, 404);

  const paths = await listBundlePaths(c.env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(
    c.env.SKILLS_R2,
    version.r2Prefix,
    paths,
  );
  const files: Record<string, string> = {};
  for (const [path, content] of bundle.entries()) {
    files[path] = content;
  }
  return c.json({ files, version: version.semver }, 200);
});

const getVersionFilesRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/skills/{slug}/versions/{versionId}/files",
  tags: ["Skills"],
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      slug: z.string(),
      versionId: z.string().uuid(),
    }),
  },
  responses: { 200: { description: "Version files" } },
});

skillRoutes.openapi(getVersionFilesRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId, slug, versionId } = c.req.valid("param");
  const access = await requireOrgRole(c.var.db, orgId, userId, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.slug, slug)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  const [version] = await c.var.db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.id, versionId))
    .limit(1);
  if (!version) return c.json({ error: "Not found" }, 404);

  const paths = await listBundlePaths(c.env.SKILLS_R2, version.r2Prefix);
  const bundle = await downloadBundleFromR2(
    c.env.SKILLS_R2,
    version.r2Prefix,
    paths,
  );
  const files: Record<string, string> = {};
  for (const [path, content] of bundle.entries()) {
    files[path] = content;
  }
  return c.json({ files }, 200);
});
