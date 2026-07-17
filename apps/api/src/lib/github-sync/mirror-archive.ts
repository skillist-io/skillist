import { registryEntries, skillProvenance, skills } from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import type { WorkerDb } from "../db";

/**
 * Hide mirror skills removed upstream: private visibility + drop registry row.
 * Keeps skill versions/provenance for audit; next sync can re-publish if restored.
 */
export async function archiveRemovedMirrorSkills(
  db: WorkerDb,
  sourceId: string,
  orgId: string,
  discoveredSlugs: ReadonlySet<string>,
): Promise<number> {
  const mirrored = await db
    .select({ skillId: skillProvenance.skillId, repo: skills.repo })
    .from(skillProvenance)
    .innerJoin(skills, eq(skillProvenance.skillId, skills.id))
    .where(and(eq(skillProvenance.sourceId, sourceId), eq(skills.orgId, orgId)));

  let archived = 0;
  for (const row of mirrored) {
    if (discoveredSlugs.has(row.repo)) continue;
    await db
      .update(skills)
      .set({ visibility: "private", updatedAt: new Date() })
      .where(eq(skills.id, row.skillId));
    await db.delete(registryEntries).where(eq(registryEntries.skillId, row.skillId));
    archived += 1;
  }
  return archived;
}
