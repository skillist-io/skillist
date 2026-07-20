import type { registryQuerySchema } from "@skillist/contracts";
import {
  registryEntries,
  registryStars,
  skillEvals,
  skills,
  skillVersions,
} from "@skillist/db/schema";
import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { WorkerDb } from "./db";

export const CLI_INSTALL = "npm install -g @skillist/cli";

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

/**
 * Relevance score for a search term, as SQL so it can rank the *whole* match
 * set rather than whichever 20 rows a page happens to contain — client-side
 * ranking would reorder one page and hide the best hit sitting at rank 21.
 *
 * The tiers follow the shape Neon uses in its command index: an exact name
 * beats a name prefix beats a name substring, identifier fields (repo, org)
 * outrank prose, and a description match is the weakest signal that still
 * counts. Quality breaks ties, so equally-relevant skills surface best-first.
 */
function relevanceScore(q: string) {
  const term = q.toLowerCase();
  return sql<number>`(
    CASE WHEN lower(${registryEntries.name}) = ${term} THEN 120
         WHEN lower(${registryEntries.name}) LIKE ${`${term}%`} THEN 90
         WHEN lower(${registryEntries.name}) LIKE ${`%${term}%`} THEN 55
         ELSE 0 END
    + CASE WHEN lower(${registryEntries.skillRepo}) = ${term} THEN 60
           WHEN lower(${registryEntries.skillRepo}) LIKE ${`%${term}%`} THEN 40
           ELSE 0 END
    + CASE WHEN lower(${registryEntries.orgSlug}) = ${term} THEN 45
           WHEN lower(${registryEntries.orgSlug}) LIKE ${`%${term}%`} THEN 25
           ELSE 0 END
    + CASE WHEN lower(${registryEntries.description}) LIKE ${`%${term}%`} THEN 20
           ELSE 0 END
  )`;
}

function registryOrderBy(query: z.infer<typeof registryQuerySchema>) {
  // Relevance is only meaningful with a term; without one it would score every
  // row 0 and collapse to an arbitrary order, so fall through to quality.
  if (query.sort === "relevance") {
    return query.q
      ? [desc(relevanceScore(query.q)), desc(registryEntries.qualityScore)]
      : [desc(registryEntries.qualityScore)];
  }

  switch (query.sort) {
    case "impact":
      return [desc(registryEntries.impactScore)];
    case "installs":
      return [desc(registryEntries.installCount)];
    case "activations":
      return [desc(registryEntries.activationCount)];
    case "stars":
      return [desc(registryEntries.stars)];
    case "trending":
      return [
        desc(
          sql`(${registryEntries.stars} * 3 + ${registryEntries.installCount} + ${registryEntries.activationCount})`,
        ),
      ];
    case "recent":
      return [desc(registryEntries.updatedAt)];
    case "name":
      return [asc(registryEntries.name)];
    case "quality":
    default:
      return [desc(registryEntries.qualityScore)];
  }
}

export async function listRegistry(db: WorkerDb, query: z.infer<typeof registryQuerySchema>) {
  const { page, limit } = query;
  const offset = (page - 1) * limit;
  const where = buildRegistryWhere(query);
  const orderBy = registryOrderBy(query);

  const items = await db
    .select({
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
      // Exposed so the sitemap can carry an accurate <lastmod>. For a registry
      // where skills republish often, lastmod is what earns fast recrawls.
      updatedAt: registryEntries.updatedAt,
      runtime: skills.runtime,
    })
    .from(registryEntries)
    .innerJoin(skills, eq(registryEntries.skillId, skills.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registryEntries)
    .innerJoin(skills, eq(registryEntries.skillId, skills.id))
    .where(where);

  return {
    items: items.map((item) => ({
      ...item,
      // Serialized for JSON transport; consumers (sitemap lastmod) need ISO-8601.
      updatedAt: item.updatedAt?.toISOString() ?? null,
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
  };
}

export async function getRegistryFacets(db: WorkerDb) {
  // Dedupe tags/agents in SQL (unnest + DISTINCT) instead of streaming every
  // row's arrays into the isolate, and run all three facet queries in parallel.
  const [categoryRows, tagRows, agentRows] = await Promise.all([
    db
      .selectDistinct({ category: registryEntries.category })
      .from(registryEntries)
      .where(sql`${registryEntries.category} IS NOT NULL`),
    db.execute(
      sql`SELECT DISTINCT jsonb_array_elements_text(${registryEntries.tags}) AS value FROM ${registryEntries}`,
    ),
    db.execute(
      sql`SELECT DISTINCT jsonb_array_elements_text(${registryEntries.compatibleAgents}) AS value FROM ${registryEntries}`,
    ),
  ]);

  const toSortedValues = (rows: unknown): string[] =>
    (rows as { value: string | null }[])
      .map((r) => r.value)
      .filter((v): v is string => Boolean(v))
      .sort();

  return {
    categories: categoryRows
      .map((r) => r.category)
      .filter((c): c is string => Boolean(c))
      .sort(),
    tags: toSortedValues(tagRows),
    agents: toSortedValues(agentRows),
    sourceTypes: ["native", "mirror"] as const,
  };
}

export async function getRegistrySkill(
  db: WorkerDb,
  org: string,
  slug: string,
  userId?: string | null,
) {
  const [row] = await db
    .select({
      entry: registryEntries,
      runtime: skills.runtime,
      skillId: skills.id,
      latestPublishedVersionId: skills.latestPublishedVersionId,
    })
    .from(registryEntries)
    .innerJoin(skills, eq(registryEntries.skillId, skills.id))
    .where(and(eq(registryEntries.orgSlug, org), eq(registryEntries.skillRepo, slug)))
    .limit(1);
  if (!row) return null;

  const versionId = row.latestPublishedVersionId;
  // star, plugin manifest, and eval summary all depend only on `row` — fetch
  // them concurrently instead of in a waterfall.
  const [starRows, versionRows, evalRows] = await Promise.all([
    userId
      ? db
          .select({ id: registryStars.id })
          .from(registryStars)
          .where(and(eq(registryStars.userId, userId), eq(registryStars.skillId, row.skillId)))
          .limit(1)
      : Promise.resolve([]),
    versionId
      ? db
          .select({ pluginManifest: skillVersions.pluginManifest })
          .from(skillVersions)
          .where(eq(skillVersions.id, versionId))
          .limit(1)
      : Promise.resolve([]),
    versionId
      ? db
          .select({
            status: skillEvals.status,
            uplift: skillEvals.uplift,
            baselineScore: skillEvals.baselineScore,
            withSkillScore: skillEvals.withSkillScore,
            completedAt: skillEvals.completedAt,
          })
          .from(skillEvals)
          .where(and(eq(skillEvals.versionId, versionId), eq(skillEvals.status, "completed")))
          .orderBy(desc(skillEvals.completedAt))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const starred = starRows.length > 0;
  const pluginManifest = versionRows[0]?.pluginManifest ?? null;
  const evalSummary = evalRows[0] ?? null;

  const entry = row.entry;
  return {
    ...entry,
    runtime: row.runtime,
    starred,
    cliInstall: CLI_INSTALL,
    installCommand: `skillist install ${entry.orgSlug}/${entry.skillRepo}`,
    pluginManifest,
    eval: evalSummary,
  };
}
