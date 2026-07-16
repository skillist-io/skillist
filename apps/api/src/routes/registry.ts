// @ts-nocheck
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { registryQuerySchema } from "@skillist/contracts";
import {
  organizations,
  registryEntries,
  registryStars,
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

function buildRegistryWhere(query: z.infer<typeof registryQuerySchema>) {
  const clauses = [];

  if (query.q) {
    clauses.push(
      or(
        ilike(registryEntries.name, `%${query.q}%`),
        ilike(registryEntries.description, `%${query.q}%`),
        ilike(registryEntries.skillSlug, `%${query.q}%`),
        ilike(registryEntries.orgSlug, `%${query.q}%`),
      ),
    );
  }

  if (query.minQuality != null) {
    clauses.push(gte(registryEntries.qualityScore, query.minQuality));
  }

  if (query.security !== "all") {
    clauses.push(eq(registryEntries.securityStatus, query.security));
  }

  if (query.runtime !== "all") {
    clauses.push(eq(skills.runtime, query.runtime));
  }

  if (query.category) {
    clauses.push(eq(registryEntries.category, query.category.toLowerCase()));
  }

  if (query.tag) {
    clauses.push(
      sql`${registryEntries.tags} @> ${JSON.stringify([query.tag.toLowerCase()])}::jsonb`,
    );
  }

  return clauses.length ? and(...clauses) : undefined;
}

function registryOrderBy(query: z.infer<typeof registryQuerySchema>) {
  switch (query.sort) {
    case "impact":
      return desc(registryEntries.impactScore);
    case "installs":
      return desc(registryEntries.installCount);
    case "activations":
      return desc(registryEntries.activationCount);
    case "stars":
      return desc(registryEntries.stars);
    case "trending":
      return desc(
        sql`(${registryEntries.stars} * 3 + ${registryEntries.installCount} + ${registryEntries.activationCount})`,
      );
    case "recent":
      return desc(registryEntries.updatedAt);
    case "name":
      return asc(registryEntries.name);
    case "quality":
    default:
      return desc(registryEntries.qualityScore);
  }
}

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
  const query = c.req.valid("query");
  const { page, limit } = query;
  const offset = (page - 1) * limit;
  const where = buildRegistryWhere(query);
  const orderBy = registryOrderBy(query);

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
      category: registryEntries.category,
      tags: registryEntries.tags,
      compatibleAgents: registryEntries.compatibleAgents,
      runtime: skills.runtime,
    })
    .from(registryEntries)
    .innerJoin(skills, eq(registryEntries.skillId, skills.id))
    .where(where)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const [countRow] = await c.var.db
    .select({ count: sql<number>`count(*)::int` })
    .from(registryEntries)
    .innerJoin(skills, eq(registryEntries.skillId, skills.id))
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

const registryFacetsRoute = createRoute({
  method: "get",
  path: "/registry/facets",
  tags: ["Registry"],
  responses: { 200: { description: "Registry filter facets" } },
});

registryRoutes.openapi(registryFacetsRoute, async (c) => {
  const categoryRows = await c.var.db
    .selectDistinct({ category: registryEntries.category })
    .from(registryEntries)
    .where(sql`${registryEntries.category} IS NOT NULL`);

  const tagRows = await c.var.db
    .select({ tags: registryEntries.tags })
    .from(registryEntries);

  const tagSet = new Set<string>();
  for (const row of tagRows) {
    for (const tag of row.tags ?? []) {
      if (tag) tagSet.add(tag);
    }
  }

  return c.json(
    {
      categories: categoryRows
        .map((r) => r.category)
        .filter(Boolean)
        .sort(),
      tags: [...tagSet].sort(),
    },
    200,
  );
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
  const userId = await resolveUserId(c);
  const [row] = await c.var.db
    .select({
      entry: registryEntries,
      runtime: skills.runtime,
      skillId: skills.id,
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

  let starred = false;
  if (userId) {
    const [star] = await c.var.db
      .select({ id: registryStars.id })
      .from(registryStars)
      .where(
        and(
          eq(registryStars.userId, userId),
          eq(registryStars.skillId, row.skillId),
        ),
      )
      .limit(1);
    starred = !!star;
  }

  const entry = row.entry;
  return c.json(
    {
      ...entry,
      runtime: row.runtime,
      starred,
      installCommand: `skillist install ${entry.orgSlug}/${entry.skillSlug}`,
    },
    200,
  );
});

const starSkillRoute = createRoute({
  method: "post",
  path: "/registry/{org}/{slug}/star",
  tags: ["Registry"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
  },
  responses: { 201: { description: "Starred" } },
});

registryRoutes.openapi(starSkillRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const { org, slug } = c.req.valid("param");

  const [entry] = await c.var.db
    .select({
      skillId: registryEntries.skillId,
      stars: registryEntries.stars,
    })
    .from(registryEntries)
    .where(
      and(
        eq(registryEntries.orgSlug, org),
        eq(registryEntries.skillSlug, slug),
      ),
    )
    .limit(1);
  if (!entry) return c.json({ error: "Not found" }, 404);

  const inserted = await c.var.db
    .insert(registryStars)
    .values({ userId, skillId: entry.skillId })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    await c.var.db
      .update(registryEntries)
      .set({
        stars: sql`${registryEntries.stars} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(registryEntries.skillId, entry.skillId));
  }

  return c.json({ ok: true, starred: true }, 201);
});

const unstarSkillRoute = createRoute({
  method: "delete",
  path: "/registry/{org}/{slug}/star",
  tags: ["Registry"],
  request: {
    params: z.object({ org: z.string(), slug: z.string() }),
  },
  responses: { 200: { description: "Unstarred" } },
});

registryRoutes.openapi(unstarSkillRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const { org, slug } = c.req.valid("param");

  const [entry] = await c.var.db
    .select({ skillId: registryEntries.skillId })
    .from(registryEntries)
    .where(
      and(
        eq(registryEntries.orgSlug, org),
        eq(registryEntries.skillSlug, slug),
      ),
    )
    .limit(1);
  if (!entry) return c.json({ error: "Not found" }, 404);

  const removed = await c.var.db
    .delete(registryStars)
    .where(
      and(
        eq(registryStars.userId, userId),
        eq(registryStars.skillId, entry.skillId),
      ),
    )
    .returning();

  if (removed.length > 0) {
    await c.var.db
      .update(registryEntries)
      .set({
        stars: sql`GREATEST(${registryEntries.stars} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(registryEntries.skillId, entry.skillId));
  }

  return c.json({ ok: true, starred: false }, 200);
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
