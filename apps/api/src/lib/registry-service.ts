import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import type { registryQuerySchema } from "@skillist/contracts";
import {
  registryEntries,
  registryStars,
  skillEvals,
  skills,
  skillVersions,
} from "@skillist/db/schema";
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

  if (query.agent) {
    clauses.push(
      sql`${registryEntries.compatibleAgents} @> ${JSON.stringify([query.agent.toLowerCase()])}::jsonb`,
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

export async function listRegistry(
  db: WorkerDb,
  query: z.infer<typeof registryQuerySchema>,
) {
  const { page, limit } = query;
  const offset = (page - 1) * limit;
  const where = buildRegistryWhere(query);
  const orderBy = registryOrderBy(query);

  const items = await db
    .select({
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

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registryEntries)
    .innerJoin(skills, eq(registryEntries.skillId, skills.id))
    .where(where);

  return {
    items: items.map((item) => ({
      ...item,
      cliInstall: CLI_INSTALL,
      installCommand: `skillist install ${item.orgSlug}/${item.skillSlug}`,
      runCommand:
        item.runtime && item.runtime !== "local"
          ? `skillist run ${item.orgSlug}/${item.skillSlug} --script scripts/...`
          : null,
    })),
    page,
    limit,
    total: countRow?.count ?? 0,
  };
}

export async function getRegistryFacets(db: WorkerDb) {
  const categoryRows = await db
    .selectDistinct({ category: registryEntries.category })
    .from(registryEntries)
    .where(sql`${registryEntries.category} IS NOT NULL`);

  const tagRows = await db.select({ tags: registryEntries.tags }).from(registryEntries);

  const tagSet = new Set<string>();
  for (const row of tagRows) {
    for (const tag of row.tags ?? []) {
      if (tag) tagSet.add(tag);
    }
  }

  const agentRows = await db
    .select({ agents: registryEntries.compatibleAgents })
    .from(registryEntries);

  const agentSet = new Set<string>();
  for (const row of agentRows) {
    for (const agent of row.agents ?? []) {
      if (agent) agentSet.add(agent);
    }
  }

  return {
    categories: categoryRows
      .map((r) => r.category)
      .filter(Boolean)
      .sort(),
    tags: [...tagSet].sort(),
    agents: [...agentSet].sort(),
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
    .where(
      and(
        eq(registryEntries.orgSlug, org),
        eq(registryEntries.skillSlug, slug),
      ),
    )
    .limit(1);
  if (!row) return null;

  let starred = false;
  if (userId) {
    const [star] = await db
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

  let pluginManifest = null;
  let evalSummary = null;
  if (row.latestPublishedVersionId) {
    const [version] = await db
      .select({ pluginManifest: skillVersions.pluginManifest })
      .from(skillVersions)
      .where(eq(skillVersions.id, row.latestPublishedVersionId))
      .limit(1);
    pluginManifest = version?.pluginManifest ?? null;

    const [evalRow] = await db
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
  return {
    ...entry,
    runtime: row.runtime,
    starred,
    cliInstall: CLI_INSTALL,
    installCommand: `skillist install ${entry.orgSlug}/${entry.skillSlug}`,
    pluginManifest,
    eval: evalSummary,
  };
}
