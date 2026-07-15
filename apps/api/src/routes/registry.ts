// @ts-nocheck
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { registryQuerySchema } from "@skillist/contracts";
import {
  organizations,
  registryEntries,
  skills,
  subscriptions,
} from "@skillist/db/schema";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { resolveUserId } from "../lib/session";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

export const registryRoutes = new OpenAPIHono<AppEnv>();

const listRegistryRoute = createRoute({
  method: "get",
  path: "/registry",
  tags: ["Registry"],
  request: { query: registryQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(
              z.object({
                orgSlug: z.string(),
                skillSlug: z.string(),
                name: z.string(),
                description: z.string(),
                latestVersion: z.string().nullable(),
                stars: z.number(),
                qualityScore: z.number().nullable(),
                impactScore: z.number().nullable(),
                securityStatus: z.string().nullable(),
                installCount: z.number(),
                activationCount: z.number(),
                runtime: z.string().nullable(),
              }),
            ),
            page: z.number(),
            limit: z.number(),
            total: z.number(),
          }),
        },
      },
      description: "Public skill registry",
    },
  },
});

registryRoutes.openapi(listRegistryRoute, async (c) => {
  const { q, page, limit } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const where = q
    ? or(
        ilike(registryEntries.name, `%${q}%`),
        ilike(registryEntries.description, `%${q}%`),
        ilike(registryEntries.skillSlug, `%${q}%`),
      )
    : undefined;

  const items = await c.var.db
    .select({
      id: registryEntries.id,
      skillId: registryEntries.skillId,
      orgSlug: registryEntries.orgSlug,
      skillSlug: registryEntries.skillSlug,
      name: registryEntries.name,
      description: registryEntries.description,
      latestVersion: registryEntries.latestVersion,
      qualityScore: registryEntries.qualityScore,
      impactScore: registryEntries.impactScore,
      securityStatus: registryEntries.securityStatus,
      installCount: registryEntries.installCount,
      activationCount: registryEntries.activationCount,
      stars: registryEntries.stars,
      runtime: skills.runtime,
    })
    .from(registryEntries)
    .innerJoin(skills, eq(registryEntries.skillId, skills.id))
    .where(where)
    .limit(limit)
    .offset(offset);

  const [countRow] = await c.var.db
    .select({ count: sql<number>`count(*)::int` })
    .from(registryEntries)
    .where(where);

  return c.json({
    items: items.map((item) => ({
      ...item,
      installCommand: `skillist install ${item.orgSlug}/${item.skillSlug}`,
      runCommand:
        item.runtime && item.runtime !== "local"
          ? `skillist run ${item.orgSlug}/${item.skillSlug} --script scripts/...`
          : null,
    })),
    page,
    limit,
    total: countRow?.count ?? 0,
  });
});

const getRegistrySkillRoute = createRoute({
  method: "get",
  path: "/registry/{org}/{slug}",
  tags: ["Registry"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
  },
  responses: { 200: { description: "Registry skill detail" } },
});

registryRoutes.openapi(getRegistrySkillRoute, async (c) => {
  const { org, slug } = c.req.valid("param");
  const [row] = await c.var.db
    .select({
      entry: registryEntries,
      runtime: skills.runtime,
    })
    .from(registryEntries)
    .innerJoin(skills, eq(registryEntries.skillId, skills.id))
    .where(
      and(
        eq(registryEntries.orgSlug, org),
        eq(registryEntries.skillSlug, slug),
      ),
    )
    .limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);
  const entry = row.entry;
  return c.json(
    {
      ...entry,
      runtime: row.runtime,
      installCommand: `skillist install ${entry.orgSlug}/${entry.skillSlug}`,
    },
    200,
  );
});

const subscribeRoute = createRoute({
  method: "post",
  path: "/registry/{org}/{slug}/subscribe",
  tags: ["Registry"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
  },
  responses: { 201: { description: "Subscribed" } },
});

registryRoutes.openapi(subscribeRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
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
  if (!skill || skill.visibility !== "public") {
    return c.json({ error: "Not found" }, 404);
  }

  await c.var.db
    .insert(subscriptions)
    .values({ userId, skillId: skill.id })
    .onConflictDoNothing();

  return c.json({ ok: true }, 201);
});

const updateVisibilityRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/skills/{slug}/visibility",
  tags: ["Skills"],
  request: {
    params: z.object({ orgId: z.string().uuid(), slug: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            visibility: z.enum(["private", "org", "public"]),
          }),
        },
      },
    },
  },
  responses: { 200: { description: "Visibility updated" } },
});

registryRoutes.openapi(updateVisibilityRoute, async (c) => {
  const userId = await resolveUserId(c);
  const { orgId, slug } = c.req.valid("param");
  const { visibility } = c.req.valid("json");
  const { requireOrgRole } = await import("../lib/org-access");
  const access = await requireOrgRole(c.var.db, orgId, userId, "editor");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.slug, slug)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  await c.var.db
    .update(skills)
    .set({ visibility, updatedAt: new Date() })
    .where(eq(skills.id, skill.id));

  if (visibility === "public" && skill.latestPublishedVersionId) {
    const [orgRow] = await c.var.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const { getPublishedMeta } = await import("../lib/publish");
    const meta = orgRow
      ? await getPublishedMeta(c.env.SKILLS_KV, orgRow.slug, slug)
      : null;
    if (meta && orgRow) {
      await c.var.db
        .insert(registryEntries)
        .values({
          skillId: skill.id,
          orgSlug: orgRow.slug,
          skillSlug: slug,
          name: meta.name,
          description: meta.description,
          latestVersion: meta.version,
        })
        .onConflictDoUpdate({
          target: registryEntries.skillId,
          set: {
            name: meta.name,
            description: meta.description,
            latestVersion: meta.version,
            updatedAt: new Date(),
          },
        });
    }
  }

  return c.json({ ok: true }, 200);
});
