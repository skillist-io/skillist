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
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Env } from "../env";
import { logAudit } from "../lib/audit";
import type { AuthContext } from "../lib/auth-middleware";
import { createReadDb, type WorkerDb } from "../lib/db";
import { errorResponses, okSchema } from "../lib/openapi";
import { listRegistry } from "../lib/registry-service";
import { resolveUserId } from "../lib/session";
import { addDayBucket, buildDayBuckets, toDaySeries } from "../lib/time-series";

const CLI_INSTALL = "npm install -g @skillist/cli";

type AppEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext; db: WorkerDb };
};

/**
 * Public browse pages are the same for every caller and tolerate a minute of
 * staleness, so the edge can answer them without the Worker or D1 running at
 * all (`cache` in wrangler.production.jsonc). This is what keeps read traffic off
 * the single database, so it must stay on any route that serves browse data.
 * `stale-if-error` keeps the registry readable through a database failure.
 */
const REGISTRY_CACHE_CONTROL =
  "public, max-age=60, stale-while-revalidate=300, stale-if-error=86400";

export const registryRoutes = new OpenAPIHono<AppEnv>();

/** A row of `registry_entries`; timestamps serialize to ISO strings. */
const registryEntrySchema = z.object({
  id: z.string().uuid(),
  skillId: z.string().uuid(),
  orgSlug: z.string(),
  skillRepo: z.string(),
  name: z.string(),
  description: z.string(),
  latestVersion: z.string().nullable(),
  qualityScore: z.number().nullable(),
  impactScore: z.number().nullable(),
  securityStatus: z.string().nullable(),
  installCount: z.number(),
  activationCount: z.number(),
  stars: z.number(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  compatibleAgents: z.array(z.string()),
  sourceType: z.string(),
  upstreamRepo: z.string().nullable(),
  upstreamUrl: z.string().nullable(),
  lastReviewedAt: z.string().nullable(),
  updatedAt: z.string(),
});

/** One point of a per-day telemetry series (`lib/time-series.ts`). */
const dayPointSchema = z.object({ date: z.string(), count: z.number() });

/** Star/unstar both echo the resulting state so a client can update in place. */
const starStateSchema = z.object({ ok: z.boolean(), starred: z.boolean() });

const listRegistryRoute = createRoute({
  method: "get",
  path: "/registry",
  tags: ["Registry"],
  operationId: "listRegistry",
  summary: "Browse the public skill registry",
  // Public browse: no credentials. Overrides the document-level default.
  security: [],
  request: { query: registryQuerySchema },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(
              z.object({
                skillId: z.string(),
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
                updatedAt: z.string().nullable(),
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
    ...errorResponses({ notFound: false, isPublic: true }),
  },
});

registryRoutes.openapi(listRegistryRoute, async (c) => {
  const query = c.req.valid("query");
  // The query is the shared listRegistry(): this route previously kept a
  // byte-for-byte copy of the filter and ordering logic, so a change to one
  // silently did nothing in the other.
  const body = await listRegistry(createReadDb(c.env), query);
  // Set after the query: a header set first would ride along on an error response.
  c.header("Cache-Control", REGISTRY_CACHE_CONTROL);
  return c.json(body);
});

const registryFacetsRoute = createRoute({
  method: "get",
  path: "/registry/facets",
  tags: ["Registry"],
  operationId: "listRegistryFacets",
  summary: "List available registry filter facets",
  // Public browse: no credentials. Overrides the document-level default.
  security: [],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            categories: z.array(z.string()),
            tags: z.array(z.string()),
            agents: z.array(z.string()),
            sourceTypes: z.array(z.string()),
          }),
        },
      },
      description: "Registry filter facets",
    },
    ...errorResponses({ validates: false, notFound: false, isPublic: true }),
  },
});

registryRoutes.openapi(registryFacetsRoute, async (c) => {
  const db = createReadDb(c.env);

  const categoryRows = await db
    .selectDistinct({ category: registryEntries.category })
    .from(registryEntries)
    .where(sql`${registryEntries.category} IS NOT NULL`);

  // Expand the JSON string arrays and dedupe in SQL rather than scanning every
  // row into memory. json_each yields no rows for an empty array.
  const tagRows = await db.all<{ tag: string }>(
    sql`SELECT DISTINCT je.value AS tag FROM ${registryEntries}, json_each(${registryEntries.tags}) AS je`,
  );

  const agentRows = await db.all<{ agent: string }>(
    sql`SELECT DISTINCT je.value AS agent FROM ${registryEntries}, json_each(${registryEntries.compatibleAgents}) AS je`,
  );

  c.header("Cache-Control", REGISTRY_CACHE_CONTROL);
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
  operationId: "getRegistrySkill",
  summary: "Get a public registry skill's detail",
  // Public browse: no credentials. Overrides the document-level default.
  security: [],
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: registryEntrySchema.extend({
            runtime: z.string().nullable(),
            starred: z.boolean(),
            cliInstall: z.string(),
            installCommand: z.string(),
            // Untyped jsonb straight off the published version.
            pluginManifest: z.unknown(),
            // Latest completed eval for the published version, when there is one.
            eval: z
              .object({
                status: z.string(),
                uplift: z.number().nullable(),
                baselineScore: z.number().nullable(),
                withSkillScore: z.number().nullable(),
                completedAt: z.string().nullable(),
              })
              .nullable(),
          }),
        },
      },
      description: "Registry skill detail",
    },
    ...errorResponses({ isPublic: true }),
  },
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
      skillId: row.skillId,
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

/**
 * Recount rather than increment: a batch can't branch on whether the star row
 * actually changed, and a recount also repairs any drift. `updatedAt` feeds the
 * "recent" sort, so a no-op re-star must not touch the row.
 */
export function syncStarCount(db: WorkerDb, skillId: string) {
  const count = sql`(SELECT count(*) FROM ${registryStars} WHERE ${registryStars.skillId} = ${skillId})`;
  return db
    .update(registryEntries)
    .set({ stars: count, updatedAt: new Date() })
    .where(and(eq(registryEntries.skillId, skillId), sql`${registryEntries.stars} != ${count}`));
}

const starSkillRoute = createRoute({
  method: "post",
  path: "/registry/{org}/{repo}/star",
  tags: ["Registry"],
  operationId: "starRegistrySkill",
  summary: "Star a registry skill",
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: {
    201: {
      content: { "application/json": { schema: starStateSchema } },
      description: "Starred",
    },
    ...errorResponses(),
  },
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

  // Star row + denormalized counter must move together, or a crash between them
  // drifts registry_entries.stars from the true registry_stars count.
  await c.var.db.batch([
    c.var.db.insert(registryStars).values({ userId, skillId: entry.skillId }).onConflictDoNothing(),
    syncStarCount(c.var.db, entry.skillId),
  ]);

  return c.json({ ok: true, starred: true }, 201);
});

const unstarSkillRoute = createRoute({
  method: "delete",
  path: "/registry/{org}/{repo}/star",
  tags: ["Registry"],
  operationId: "unstarRegistrySkill",
  summary: "Remove a star from a registry skill",
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: starStateSchema } },
      description: "Unstarred",
    },
    ...errorResponses(),
  },
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

  await c.var.db.batch([
    c.var.db
      .delete(registryStars)
      .where(and(eq(registryStars.userId, userId), eq(registryStars.skillId, entry.skillId))),
    syncStarCount(c.var.db, entry.skillId),
  ]);

  return c.json({ ok: true, starred: false }, 200);
});

const registryAnalyticsRoute = createRoute({
  method: "get",
  path: "/registry/{org}/{repo}/analytics",
  tags: ["Registry"],
  operationId: "getRegistrySkillAnalytics",
  summary: "Get install and activation time series for a skill",
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
    query: z.object({ days: z.coerce.number().min(1).max(90).default(30) }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            installs: z.number(),
            activations: z.number(),
            series: z.object({
              installs: z.array(dayPointSchema),
              activations: z.array(dayPointSchema),
            }),
          }),
        },
      },
      description: "Per-skill telemetry time series",
    },
    ...errorResponses(),
  },
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
      day: sql<string>`date(${telemetryEvents.createdAt} / 1000, 'unixepoch')`,
      eventType: telemetryEvents.eventType,
      count: sql<number>`count(*)`,
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
      sql`date(${telemetryEvents.createdAt} / 1000, 'unixepoch')`,
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
  operationId: "subscribeToRegistrySkill",
  summary: "Subscribe to a public skill's publish events",
  request: {
    params: z.object({ org: z.string(), repo: z.string() }),
  },
  responses: {
    201: {
      content: { "application/json": { schema: okSchema } },
      description: "Subscribed",
    },
    ...errorResponses(),
  },
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
  operationId: "updateSkillVisibility",
  summary: "Change a skill's visibility",
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
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Visibility updated",
    },
    ...errorResponses(),
  },
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

  // Exposing a private skill publicly (or retracting one) is the highest-blast
  // -radius change available here, so record the transition on both sides.
  await logAudit(c.var.db, {
    orgId,
    actorId: userId,
    actorType: "user",
    action: "skill.visibility.update",
    resourceType: "skill",
    resourceId: skill.id,
    metadata: { repo, from: skill.visibility, to: visibility },
  });

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

    const [orgRow] = await c.var.db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (orgRow) {
      const { purgeDeliveryCache } = await import("../lib/publish");
      // Hono's ExecutionContext type predates `cache`.
      const { cache } = c.executionCtx as unknown as { cache?: CacheContext };
      await purgeDeliveryCache(cache, orgRow.slug, repo);
    }
  }

  return c.json({ ok: true }, 200);
});
