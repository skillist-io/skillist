import {
  organizations,
  orgRequiredSkills,
  projectItems,
  projects,
  registryEntries,
  skillInventory,
  skills,
  telemetryEvents,
} from "@skillist/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { WorkerDb } from "./db";

const ref = (orgSlug: string, skillRepo: string) => `${orgSlug}/${skillRepo}`;

export type CoveragePerSkill = {
  ref: string;
  orgSlug: string;
  skillRepo: string;
  published: boolean;
  inventoryCount: number;
  projectCount: number;
  covered: boolean;
  installs: number;
  activations: number;
  activated: boolean;
  lastActivatedAt: string | null;
};

export type CoverageResult = {
  summary: {
    required: number;
    published: number;
    covered: number;
    activated: number;
    drifted: number;
    coveragePct: number;
  };
  skills: CoveragePerSkill[];
  drift: string[];
};

/**
 * Three-layer visibility for an org's required skills:
 *   published  — the skill exists in the registry (installable)
 *   covered    — it is actually present in the org's scanned inventory and/or
 *                curated into a project
 *   activated  — agents have activated it (telemetry activation events)
 * plus a drift list (required but not covered). Computed with a handful of
 * grouped queries keyed by `orgSlug/skillRepo`, then folded over the required
 * list in memory — no per-skill round-trips.
 *
 * Shared by the `/orgs/{orgId}/coverage` route (routes/governance/coverage.ts)
 * and the platform agent's `get_coverage` tool so the SQL lives in one place.
 */
export async function computeCoverage(db: WorkerDb, orgId: string): Promise<CoverageResult> {
  const required = await db
    .select({ orgSlug: orgRequiredSkills.orgSlug, skillRepo: orgRequiredSkills.skillRepo })
    .from(orgRequiredSkills)
    .where(eq(orgRequiredSkills.orgId, orgId));

  if (required.length === 0) {
    return {
      summary: {
        required: 0,
        published: 0,
        covered: 0,
        activated: 0,
        drifted: 0,
        coveragePct: 100,
      },
      skills: [],
      drift: [],
    };
  }

  const repos = [...new Set(required.map((r) => r.skillRepo))];

  // Layer 1 — published: which required refs exist as registry entries.
  const published = await db
    .select({ orgSlug: registryEntries.orgSlug, skillRepo: registryEntries.skillRepo })
    .from(registryEntries)
    .where(inArray(registryEntries.skillRepo, repos));
  const publishedSet = new Set(published.map((p) => ref(p.orgSlug, p.skillRepo)));

  // Layer 2a — covered via inventory: distinct scanned repos that carry a
  // managed skill matching a required ref.
  const inventoryRows = await db
    .select({
      orgSlug: skillInventory.registryOrgSlug,
      skillRepo: skillInventory.registryRepo,
      repoCount: sql<number>`count(distinct ${skillInventory.repoFullName})::int`,
    })
    .from(skillInventory)
    .where(and(eq(skillInventory.orgId, orgId), eq(skillInventory.managed, true)))
    .groupBy(skillInventory.registryOrgSlug, skillInventory.registryRepo);
  const inventoryMap = new Map<string, number>();
  for (const row of inventoryRows) {
    if (row.orgSlug && row.skillRepo)
      inventoryMap.set(ref(row.orgSlug, row.skillRepo), row.repoCount);
  }

  // Layer 2b — covered via projects: distinct projects in this org curating a
  // skill whose owning org+repo matches a required ref.
  const projectRows = await db
    .select({
      orgSlug: organizations.slug,
      skillRepo: skills.repo,
      projectCount: sql<number>`count(distinct ${projectItems.projectId})::int`,
    })
    .from(projectItems)
    .innerJoin(projects, eq(projects.id, projectItems.projectId))
    .innerJoin(skills, eq(skills.id, projectItems.skillId))
    .innerJoin(organizations, eq(organizations.id, skills.orgId))
    .where(and(eq(projects.orgId, orgId), eq(projectItems.kind, "skill")))
    .groupBy(organizations.slug, skills.repo);
  const projectMap = new Map<string, number>();
  for (const row of projectRows) projectMap.set(ref(row.orgSlug, row.skillRepo), row.projectCount);

  // Layer 3 — activated: install/activation telemetry per required ref.
  const telemetryRows = await db
    .select({
      orgSlug: telemetryEvents.orgSlug,
      skillRepo: telemetryEvents.skillRepo,
      installs: sql<number>`count(*) filter (where ${telemetryEvents.eventType} = 'install')::int`,
      activations: sql<number>`count(*) filter (where ${telemetryEvents.eventType} = 'activation')::int`,
      lastActivatedAt: sql<
        string | null
      >`max(${telemetryEvents.createdAt}) filter (where ${telemetryEvents.eventType} = 'activation')`,
    })
    .from(telemetryEvents)
    .where(inArray(telemetryEvents.skillRepo, repos))
    .groupBy(telemetryEvents.orgSlug, telemetryEvents.skillRepo);
  const telemetryMap = new Map<
    string,
    { installs: number; activations: number; lastActivatedAt: string | null }
  >();
  for (const row of telemetryRows) {
    telemetryMap.set(ref(row.orgSlug, row.skillRepo), {
      installs: row.installs,
      activations: row.activations,
      lastActivatedAt: row.lastActivatedAt,
    });
  }

  const skillsOut: CoveragePerSkill[] = required.map((r) => {
    const key = ref(r.orgSlug, r.skillRepo);
    const inventoryCount = inventoryMap.get(key) ?? 0;
    const projectCount = projectMap.get(key) ?? 0;
    const tel = telemetryMap.get(key) ?? { installs: 0, activations: 0, lastActivatedAt: null };
    const covered = inventoryCount > 0 || projectCount > 0;
    return {
      ref: key,
      orgSlug: r.orgSlug,
      skillRepo: r.skillRepo,
      published: publishedSet.has(key),
      inventoryCount,
      projectCount,
      covered,
      installs: tel.installs,
      activations: tel.activations,
      activated: tel.activations > 0,
      lastActivatedAt: tel.lastActivatedAt,
    };
  });

  const covered = skillsOut.filter((s) => s.covered).length;
  const drift = skillsOut.filter((s) => !s.covered).map((s) => s.ref);

  return {
    summary: {
      required: skillsOut.length,
      published: skillsOut.filter((s) => s.published).length,
      covered,
      activated: skillsOut.filter((s) => s.activated).length,
      drifted: drift.length,
      coveragePct: Math.round((covered / skillsOut.length) * 100),
    },
    skills: skillsOut,
    drift,
  };
}
