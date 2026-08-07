import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { telemetryEventSchema } from "@skillist/contracts";
import {
  auditEvents,
  organizations,
  registryEntries,
  skillRuns,
  telemetryEvents,
} from "@skillist/db/schema";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { errorResponses, okSchema } from "../../lib/openapi";
import { requireOrgAccess } from "../../lib/org-access";
import { resolveUserId } from "../../lib/session";
import { addDayBucket, buildDayBuckets, toDaySeries } from "../../lib/time-series";
import { type AppEnv, dayPointSchema, skillRunRowSchema } from "./shared";

export const observabilityRoutes = new OpenAPIHono<AppEnv>();

/** Per-skill install/activation totals, denormalized on `registry_entries`. */
const bySkillSchema = z.array(
  z.object({
    skillRepo: z.string(),
    installCount: z.number(),
    activationCount: z.number(),
  }),
);

/**
 * Where the org's skills are actually being delivered. Rows come from
 * `skillist sync`, which reports one activation per (skill, harness), so
 * `skills` is the distinct skill count live in that harness — the answer to
 * "which agents in this org actually have this estate."
 */
const byHarnessSchema = z.array(
  z.object({
    harness: z.string(),
    activations: z.number(),
    skills: z.number(),
    projectScoped: z.number(),
    userScoped: z.number(),
  }),
);

const auditRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/audit",
  tags: ["Governance"],
  operationId: "listAuditEvents",
  summary: "List an organization's audit log",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(
              z.object({
                id: z.string().uuid(),
                orgId: z.string().uuid().nullable(),
                actorId: z.string().nullable(),
                actorType: z.string(),
                action: z.string(),
                resourceType: z.string(),
                resourceId: z.string().nullable(),
                // Per-action detail bag; the keys differ by `action`.
                metadata: z.record(z.string(), z.unknown()).nullable(),
                createdAt: z.string(),
              }),
            ),
          }),
        },
      },
      description: "Audit log",
    },
    ...errorResponses({ notFound: false }),
  },
});

observabilityRoutes.openapi(auditRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { limit } = c.req.valid("query");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const items = await c.var.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.orgId, orgId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);

  return c.json({ items }, 200);
});

const telemetryIngestRoute = createRoute({
  method: "post",
  path: "/telemetry",
  tags: ["Telemetry"],
  operationId: "recordTelemetryEvent",
  summary: "Record a skill install or activation event",
  request: {
    body: { content: { "application/json": { schema: telemetryEventSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: okSchema } },
      description: "Recorded",
    },
    ...errorResponses({ notFound: false }),
  },
});

observabilityRoutes.openapi(telemetryIngestRoute, async (c) => {
  const body = c.req.valid("json");
  const userId = await resolveUserId(c);
  const apiKeyId = c.var.auth.apiKeyId ?? null;

  // Require an authenticated identity (session or API key). Telemetry drives
  // public registry ranking (install/activation counts), so anonymous ingestion
  // lets anyone inflate any skill's standing and write unbounded rows.
  if (!userId && !apiKeyId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // The (org, skill) must resolve to a real registry entry. A `registry_entries`
  // row exists only for a PUBLIC, published skill (written under `if (isPublic)`
  // at publish time), so this both rejects events for arbitrary/private skills
  // and prevents an attacker from writing unbounded telemetry rows for strings
  // that name nothing. Counters can only move for skills that are actually live.
  const [entry] = await c.var.db
    .select({ id: registryEntries.id })
    .from(registryEntries)
    .where(
      and(eq(registryEntries.orgSlug, body.orgSlug), eq(registryEntries.skillRepo, body.skillRepo)),
    )
    .limit(1);
  if (!entry) {
    return c.json({ error: "Not found" }, 404);
  }

  // Deduplicate the ranking signal per (actor, skill, eventType, UTC day): one
  // actor looping this endpoint can move a counter by at most +1/day/skill, so
  // it can't be spun to manipulate registry standing. The raw event row is still
  // recorded every call for analytics; only the denormalized counter is gated.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  // One of userId / apiKeyId is non-null here (enforced by the 401 above).
  const actorFilter = userId
    ? eq(telemetryEvents.userId, userId)
    : eq(telemetryEvents.apiKeyId, apiKeyId ?? "");
  const [priorToday] = await c.var.db
    .select({ id: telemetryEvents.id })
    .from(telemetryEvents)
    .where(
      and(
        eq(telemetryEvents.orgSlug, body.orgSlug),
        eq(telemetryEvents.skillRepo, body.skillRepo),
        eq(telemetryEvents.eventType, body.eventType),
        gte(telemetryEvents.createdAt, startOfDay),
        actorFilter,
      ),
    )
    .limit(1);

  // The raw row is written on every call — including the per-harness rows one
  // `skillist sync` emits for the same skill — so the delivery dataset stays
  // complete even though the ranking counter below is deduped to +1/day/actor.
  await c.var.db.insert(telemetryEvents).values({
    orgSlug: body.orgSlug,
    skillRepo: body.skillRepo,
    eventType: body.eventType,
    projectHash: body.projectHash ?? null,
    harness: body.harness ?? null,
    scope: body.scope ?? null,
    userId,
    apiKeyId,
  });

  if (!priorToday) {
    const column = body.eventType === "install" ? "installCount" : "activationCount";
    await c.var.db
      .update(registryEntries)
      .set({
        [column]: sql`${registryEntries[column]} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(registryEntries.orgSlug, body.orgSlug),
          eq(registryEntries.skillRepo, body.skillRepo),
        ),
      );
  }

  return c.json({ ok: true }, 201);
});

const orgTelemetryRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/telemetry",
  tags: ["Governance"],
  operationId: "getOrgTelemetry",
  summary: "Summarize an organization's install and activation telemetry",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            events: z.number(),
            installs: z.number(),
            activations: z.number(),
            bySkill: bySkillSchema,
          }),
        },
      },
      description: "Telemetry summary",
    },
    ...errorResponses(),
  },
});

observabilityRoutes.openapi(orgTelemetryRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { days } = c.req.valid("query");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [org] = await c.var.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return c.json({ error: "Not found" }, 404);

  const since = new Date();
  since.setDate(since.getDate() - days);

  // Counted in SQL, not by pulling every row into the isolate and calling
  // .filter() on it — telemetry_events is the fastest-growing table and this
  // window can span 90 days. (The sibling /observability route below already
  // aggregated correctly; this one was simply missed.)
  const countRows = await c.var.db
    .select({
      eventType: telemetryEvents.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(telemetryEvents)
    .where(and(eq(telemetryEvents.orgSlug, org.slug), gte(telemetryEvents.createdAt, since)))
    .groupBy(telemetryEvents.eventType);

  const registry = await c.var.db
    .select({
      skillRepo: registryEntries.skillRepo,
      installCount: registryEntries.installCount,
      activationCount: registryEntries.activationCount,
    })
    .from(registryEntries)
    .where(eq(registryEntries.orgSlug, org.slug));

  const countFor = (type: string) => countRows.find((r) => r.eventType === type)?.count ?? 0;

  return c.json(
    {
      events: countRows.reduce((sum, r) => sum + r.count, 0),
      installs: countFor("install"),
      activations: countFor("activation"),
      bySkill: registry,
    },
    200,
  );
});

const observabilityRoute = createRoute({
  method: "get",
  path: "/orgs/{orgId}/observability",
  tags: ["Governance"],
  operationId: "getOrgObservability",
  summary: "Get an organization's run and telemetry observability dashboard",
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            telemetry: z.object({
              events: z.number(),
              installs: z.number(),
              activations: z.number(),
              bySkill: bySkillSchema,
              byHarness: byHarnessSchema,
            }),
            runs: z.object({
              total: z.number(),
              finished: z.number(),
              succeeded: z.number(),
              failed: z.number(),
              // Null rather than 0 when nothing has finished, so a client can
              // tell "no data" from "everything failed".
              successRate: z.number().nullable(),
              avgDurationMs: z.number(),
              byRuntime: z.record(z.string(), z.number()),
              recent: z.array(skillRunRowSchema),
            }),
            series: z.object({
              runs: z.array(dayPointSchema),
              successes: z.array(dayPointSchema),
              installs: z.array(dayPointSchema),
              activations: z.array(dayPointSchema),
            }),
          }),
        },
      },
      description: "Org observability",
    },
    ...errorResponses(),
  },
});

observabilityRoutes.openapi(observabilityRoute, async (c) => {
  const { orgId } = c.req.valid("param");
  const { days } = c.req.valid("query");
  const access = await requireOrgAccess(c.var.db, orgId, c.var.auth, "viewer");
  if (!access.ok) return c.json({ error: "Forbidden" }, access.status);

  const [org] = await c.var.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return c.json({ error: "Not found" }, 404);

  const since = new Date();
  since.setDate(since.getDate() - days);

  // Per-day telemetry counts by event type (UTC day, matching the JS bucketing).
  const eventRows = await c.var.db
    .select({
      day: sql<string>`(${telemetryEvents.createdAt} AT TIME ZONE 'UTC')::date::text`,
      eventType: telemetryEvents.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(telemetryEvents)
    .where(and(eq(telemetryEvents.orgSlug, org.slug), gte(telemetryEvents.createdAt, since)))
    .groupBy(
      sql`(${telemetryEvents.createdAt} AT TIME ZONE 'UTC')::date`,
      telemetryEvents.eventType,
    );

  const registry = await c.var.db
    .select({
      skillRepo: registryEntries.skillRepo,
      installCount: registryEntries.installCount,
      activationCount: registryEntries.activationCount,
    })
    .from(registryEntries)
    .where(eq(registryEntries.orgSlug, org.slug));

  // Delivery breakdown by harness. Aggregated in SQL for the same reason as the
  // day series above: this window can span 90 days of the fastest-growing table.
  // Rows predating `skillist sync` have a null harness and are excluded rather
  // than bucketed as "unknown", so the panel never implies a harness we did not
  // actually observe.
  const harnessRows = await c.var.db
    .select({
      harness: telemetryEvents.harness,
      activations: sql<number>`count(*)::int`,
      skills: sql<number>`count(distinct ${telemetryEvents.skillRepo})::int`,
      projectScoped: sql<number>`(count(*) filter (where ${telemetryEvents.scope} = 'project'))::int`,
      userScoped: sql<number>`(count(*) filter (where ${telemetryEvents.scope} = 'user'))::int`,
    })
    .from(telemetryEvents)
    .where(
      and(
        eq(telemetryEvents.orgSlug, org.slug),
        gte(telemetryEvents.createdAt, since),
        eq(telemetryEvents.eventType, "activation"),
        isNotNull(telemetryEvents.harness),
      ),
    )
    .groupBy(telemetryEvents.harness)
    .orderBy(desc(sql`count(*)`));

  const runsWhere = and(eq(skillRuns.orgSlug, org.slug), gte(skillRuns.createdAt, since));

  // Per-day run + success counts (success = exitCode 0, matching the JS check).
  const runDayRows = await c.var.db
    .select({
      day: sql<string>`(${skillRuns.createdAt} AT TIME ZONE 'UTC')::date::text`,
      total: sql<number>`count(*)::int`,
      successes: sql<number>`(count(*) filter (where ${skillRuns.exitCode} = 0))::int`,
    })
    .from(skillRuns)
    .where(runsWhere)
    .groupBy(sql`(${skillRuns.createdAt} AT TIME ZONE 'UTC')::date`);

  // Scalar run aggregates. `finished` = completed|failed; `succeeded` = finished
  // with exitCode 0. Duration sum/count are returned raw so the JS-side
  // Math.round(sum / count) stays byte-identical to the previous in-memory math.
  const [runStats] = await c.var.db
    .select({
      total: sql<number>`count(*)::int`,
      finished: sql<number>`(count(*) filter (where ${skillRuns.status} in ('completed', 'failed')))::int`,
      succeeded: sql<number>`(count(*) filter (where ${skillRuns.status} in ('completed', 'failed') and ${skillRuns.exitCode} = 0))::int`,
      durationSum: sql<number>`coalesce((sum(${skillRuns.durationMs}) filter (where ${skillRuns.status} in ('completed', 'failed') and ${skillRuns.durationMs} > 0)), 0)::float8`,
      durationCount: sql<number>`(count(*) filter (where ${skillRuns.status} in ('completed', 'failed') and ${skillRuns.durationMs} > 0))::int`,
    })
    .from(skillRuns)
    .where(runsWhere);

  // Runtime breakdown. Ordering by each runtime's most-recent run (desc)
  // reproduces the first-seen insertion order of the previous JS reduce over
  // runs sorted by createdAt desc, so the object's key order is preserved.
  const runtimeRows = await c.var.db
    .select({ runtime: skillRuns.runtime, count: sql<number>`count(*)::int` })
    .from(skillRuns)
    .where(runsWhere)
    .groupBy(skillRuns.runtime)
    .orderBy(desc(sql`max(${skillRuns.createdAt})`));

  const recentRuns = await c.var.db
    .select()
    .from(skillRuns)
    .where(runsWhere)
    .orderBy(desc(skillRuns.createdAt))
    .limit(20);

  const runBuckets = buildDayBuckets(days);
  const successBuckets = buildDayBuckets(days);
  const installBuckets = buildDayBuckets(days);
  const activationBuckets = buildDayBuckets(days);

  for (const row of runDayRows) {
    addDayBucket(runBuckets, row.day, row.total);
    addDayBucket(successBuckets, row.day, row.successes);
  }

  let events = 0;
  let installs = 0;
  let activations = 0;
  for (const row of eventRows) {
    events += row.count;
    if (row.eventType === "install") {
      installs += row.count;
      addDayBucket(installBuckets, row.day, row.count);
    } else if (row.eventType === "activation") {
      activations += row.count;
      addDayBucket(activationBuckets, row.day, row.count);
    }
  }

  const finished = runStats?.finished ?? 0;
  const succeeded = runStats?.succeeded ?? 0;
  const durationCount = runStats?.durationCount ?? 0;
  const avgDurationMs = durationCount
    ? Math.round((runStats?.durationSum ?? 0) / durationCount)
    : 0;

  const byRuntime: Record<string, number> = {};
  for (const row of runtimeRows) {
    byRuntime[row.runtime] = row.count;
  }

  return c.json(
    {
      telemetry: {
        events,
        installs,
        activations,
        bySkill: registry,
        // `harness` is non-null by the query's own filter; the cast keeps the
        // response type free of a null the schema does not allow.
        byHarness: harnessRows.map((r) => ({ ...r, harness: r.harness as string })),
      },
      runs: {
        total: runStats?.total ?? 0,
        finished,
        succeeded,
        failed: finished - succeeded,
        successRate: finished > 0 ? Math.round((succeeded / finished) * 100) : null,
        avgDurationMs,
        byRuntime,
        recent: recentRuns,
      },
      series: {
        runs: toDaySeries(runBuckets),
        successes: toDaySeries(successBuckets),
        installs: toDaySeries(installBuckets),
        activations: toDaySeries(activationBuckets),
      },
    },
    200,
  );
});
