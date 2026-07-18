import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { registryQuerySchema } from "@skillist/contracts";
import {
  organizations,
  registryEntries,
  registryStars,
  skillEvals,
  skills,
  skillVersions,
  subscriptions,
  telemetryEvents,
} from "@skillist/db/schema";
import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import type { Env } from "../env";
import type { AuthContext } from "../lib/auth-middleware";
import type { WorkerDb } from "../lib/db";
import { resolveUserId } from "../lib/session";
import { addDayBucket, buildDayBuckets, toDaySeries } from "../lib/time-series";

const CLI_INSTALL = "npm install -g @skillist/cli";

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
        ilike(registryEntries.skillRepo, `%${query.q}%`),
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

  if (query.agent) {
    clauses.push(
      sql`${registryEntries.compatibleAgents} @> ${JSON.stringify([query.agent.toLowerCase()])}::jsonb`,
    );
  }

  if (query.sourceType && query.sourceType !== "all") {
    clauses.push(eq(registryEntries.sourceType, query.sourceType));
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
        sql`(
          SELECT count(*)::int FROM ${telemetryEvents}
          WHERE ${telemetryEvents.orgSlug} = ${registryEntries.orgSlug}
            AND ${telemetryEvents.skillRepo} = ${registryEntries.skillRepo}
            AND ${telemetryEvents.createdAt} >= now() - interval '7 days'
        ) * 2 + ${registryEntries.stars} * 3 + ${registryEntries.installCount}`,
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
                skillRepo: z.string(),
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
      skillRepo: registryEntries.skillRepo,
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
      sourceType: registryEntries.sourceType,
      upstreamRepo: registryEntries.upstreamRepo,
      upstreamUrl: registryEntries.upstreamUrl,
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
      cliInstall: CLI_INSTALL,
      installCommand: `skillist install ${item.orgSlug}/${item.skillRepo}`,
      runCommand:
        item.runtime && item.runtime !== "local"
          ? `skillist run ${item.orgSlug}/${item.skillRepo} --script scripts/...`
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

  // Expand the jsonb string arrays and dedupe in SQL rather than scanning every
  // row into memory. `tags`/`compatible_agents` are non-null jsonb string arrays;
  // set-returning `jsonb_array_elements_text` yields no rows for empty arrays.
  const tagRows = await c.var.db
    .selectDistinct({ tag: sql<string>`jsonb_array_elements_text(${registryEntries.tags})` })
    .from(registryEntries);

  const agentRows = await c.var.db
    .selectDistinct({
      agent: sql<string>`jsonb_array_elements_text(${registryEntries.compatibleAgents})`,
    })
    .from(registryEntries);

  return c.json(
    {
      categories: categoryRows
        .map((r) => r.category)
        .filter(Boolean)
        .sort(),
      tags: tagRows
        .map((r) => r.tag)
        .filter(Boolean)
        .sort(),
      agents: agentRows
        .map((r) => r.agent)
        .filter(Boolean)
        .sort(),
      sourceTypes: ["native", "mirror"],
    },
    200,
  );
});

const getRegistrySkillRoute = createRoute({
  method: "get",
  path: "/registry/{org}/{repo}",
  tags: ["Registry"],
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: { 200: { description: "Registry skill detail" } },
});

registryRoutes.openapi(getRegistrySkillRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const userId = await resolveUserId(c);
  const [row] = await c.var.db
    .select({
      entry: registryEntries,
      runtime: skills.runtime,
      skillId: skills.id,
      latestPublishedVersionId: skills.latestPublishedVersionId,
    })
    .from(registryEntries)
    .innerJoin(skills, eq(registryEntries.skillId, skills.id))
    .where(and(eq(registryEntries.orgSlug, org), eq(registryEntries.skillRepo, repo)))
    .limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);

  let starred = false;
  if (userId) {
    const [star] = await c.var.db
      .select({ id: registryStars.id })
      .from(registryStars)
      .where(and(eq(registryStars.userId, userId), eq(registryStars.skillId, row.skillId)))
      .limit(1);
    starred = !!star;
  }

  let pluginManifest = null;
  let evalSummary = null;
  if (row.latestPublishedVersionId) {
    const [version] = await c.var.db
      .select({ pluginManifest: skillVersions.pluginManifest })
      .from(skillVersions)
      .where(eq(skillVersions.id, row.latestPublishedVersionId))
      .limit(1);
    pluginManifest = version?.pluginManifest ?? null;

    const [evalRow] = await c.var.db
      .select({
        status: skillEvals.status,
        uplift: skillEvals.uplift,
        baselineScore: skillEvals.baselineScore,
        withSkillScore: skillEvals.withSkillScore,
        completedAt: skillEvals.completedAt,
      })
      .from(skillEvals)
      .where(
        and(
          eq(skillEvals.versionId, row.latestPublishedVersionId),
          eq(skillEvals.status, "completed"),
        ),
      )
      .orderBy(desc(skillEvals.completedAt))
      .limit(1);
    if (evalRow) evalSummary = evalRow;
  }

  const entry = row.entry;
  return c.json(
    {
      ...entry,
      runtime: row.runtime,
      starred,
      cliInstall: CLI_INSTALL,
      installCommand: `skillist install ${entry.orgSlug}/${entry.skillRepo}`,
      pluginManifest,
      eval: evalSummary,
    },
    200,
  );
});

const starSkillRoute = createRoute({
  method: "post",
  path: "/registry/{org}/{repo}/star",
  tags: ["Registry"],
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: { 201: { description: "Starred" } },
});

registryRoutes.openapi(starSkillRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const { org, repo } = c.req.valid("param");

  const [entry] = await c.var.db
    .select({
      skillId: registryEntries.skillId,
      stars: registryEntries.stars,
    })
    .from(registryEntries)
    .where(and(eq(registryEntries.orgSlug, org), eq(registryEntries.skillRepo, repo)))
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
  path: "/registry/{org}/{repo}/star",
  tags: ["Registry"],
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: { 200: { description: "Unstarred" } },
});

registryRoutes.openapi(unstarSkillRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const { org, repo } = c.req.valid("param");

  const [entry] = await c.var.db
    .select({ skillId: registryEntries.skillId })
    .from(registryEntries)
    .where(and(eq(registryEntries.orgSlug, org), eq(registryEntries.skillRepo, repo)))
    .limit(1);
  if (!entry) return c.json({ error: "Not found" }, 404);

  const removed = await c.var.db
    .delete(registryStars)
    .where(and(eq(registryStars.userId, userId), eq(registryStars.skillId, entry.skillId)))
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

const registryAnalyticsRoute = createRoute({
  method: "get",
  path: "/registry/{org}/{repo}/analytics",
  tags: ["Registry"],
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
    query: z.object({ days: z.coerce.number().min(1).max(90).default(30) }),
  },
  responses: { 200: { description: "Per-skill telemetry time series" } },
});

registryRoutes.openapi(registryAnalyticsRoute, async (c) => {
  const { org, repo } = c.req.valid("param");
  const { days } = c.req.valid("query");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Aggregate per-day counts by event type in SQL. The UTC day key matches the
  // JS bucketing (`createdAt.toISOString().slice(0, 10)`); day rows outside the
  // requested window are dropped by `addDayBucket`, while the top-level totals
  // sum every matching event (the rolling `since` window, as before).
  const eventRows = await c.var.db
    .select({
      day: sql<string>`(${telemetryEvents.createdAt} AT TIME ZONE 'UTC')::date::text`,
      eventType: telemetryEvents.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(telemetryEvents)
    .where(
      and(
        eq(telemetryEvents.orgSlug, org),
        eq(telemetryEvents.skillRepo, repo),
        gte(telemetryEvents.createdAt, since),
      ),
    )
    .groupBy(
      sql`(${telemetryEvents.createdAt} AT TIME ZONE 'UTC')::date`,
      telemetryEvents.eventType,
    );

  const installBuckets = buildDayBuckets(days);
  const activationBuckets = buildDayBuckets(days);
  let installs = 0;
  let activations = 0;
  for (const row of eventRows) {
    if (row.eventType === "install") {
      installs += row.count;
      addDayBucket(installBuckets, row.day, row.count);
    } else if (row.eventType === "activation") {
      activations += row.count;
      addDayBucket(activationBuckets, row.day, row.count);
    }
  }

  return c.json(
    {
      installs,
      activations,
      series: {
        installs: toDaySeries(installBuckets),
        activations: toDaySeries(activationBuckets),
      },
    },
    200,
  );
});

const subscribeRoute = createRoute({
  method: "post",
  path: "/registry/{org}/{repo}/subscribe",
  tags: ["Registry"],
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: { 201: { description: "Subscribed" } },
});

registryRoutes.openapi(subscribeRoute, async (c) => {
  const userId = await resolveUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const { org, repo } = c.req.valid("param");

  const [orgRow] = await c.var.db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, org))
    .limit(1);
  if (!orgRow) return c.json({ error: "Not found" }, 404);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgRow.id), eq(skills.repo, repo)))
    .limit(1);
  if (!skill || skill.visibility !== "public") {
    return c.json({ error: "Not found" }, 404);
  }

  await c.var.db.insert(subscriptions).values({ userId, skillId: skill.id }).onConflictDoNothing();

  return c.json({ ok: true }, 201);
});

const updateVisibilityRoute = createRoute({
  method: "patch",
  path: "/orgs/{orgId}/skills/{repo}/visibility",
  tags: ["Skills"],
  request: {
    params: z.object({ orgId: z.string().uuid(), repo: z.string() }),
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
  const { orgId, repo } = c.req.valid("param");
  const { visibility } = c.req.valid("json");
  const { requireOrgRole } = await import("../lib/org-access");
  const access = await requireOrgRole(c.var.db, orgId, userId, "editor");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [skill] = await c.var.db
    .select()
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.repo, repo)))
    .limit(1);
  if (!skill) return c.json({ error: "Not found" }, 404);

  await c.var.db
    .update(skills)
    .set({ visibility, updatedAt: new Date() })
    .where(eq(skills.id, skill.id));

  // Re-sync the public edge cache for the new visibility (caches SKILL.md/meta
  // when public, purges it otherwise) so delivery reflects the change at once.
  const { syncSkillEdge } = await import("../lib/ai");
  await syncSkillEdge(c.env, c.var.db, skill.id);

  if (visibility === "public" && skill.latestPublishedVersionId) {
    const [orgRow] = await c.var.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    // syncSkillEdge above (re)populated the KV meta from R2 for public skills.
    const { getPublishedMeta } = await import("../lib/publish");
    const meta = orgRow ? await getPublishedMeta(c.env.SKILLS_KV, orgRow.slug, repo) : null;
    if (meta && orgRow) {
      await c.var.db
        .insert(registryEntries)
        .values({
          skillId: skill.id,
          orgSlug: orgRow.slug,
          skillRepo: repo,
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
  } else {
    // Leaving public: drop the skill from the public registry index so it stops
    // appearing in discovery.
    await c.var.db.delete(registryEntries).where(eq(registryEntries.skillId, skill.id));
  }

  return c.json({ ok: true }, 200);
});
