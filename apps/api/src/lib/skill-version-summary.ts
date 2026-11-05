import { skills, skillVersions } from "@skillist/db/schema";
import { compareSemver } from "@skillist/skill-format";
import { and, eq, inArray } from "drizzle-orm";
import type { WorkerDb } from "./db";

/**
 * One query for the whole org: callers show version state per row, and a
 * request per skill would not survive a catalog of any real size.
 */
export function loadOrgVersions(db: WorkerDb, orgId: string) {
  return db
    .select({
      skillId: skillVersions.skillId,
      status: skillVersions.status,
      semver: skillVersions.semver,
    })
    .from(skillVersions)
    .innerJoin(skills, eq(skills.id, skillVersions.skillId))
    .where(and(eq(skills.orgId, orgId), inArray(skillVersions.status, ["draft", "published"])));
}

/**
 * A draft only counts when it is newer than what's live. Older drafts stay
 * behind after a later version publishes, and they aren't waiting on anyone.
 */
export function summarizeVersions(
  versions: { skillId: string; status: string; semver: string }[],
  skillId: string,
): { publishedSemver: string | null; draftSemver: string | null } {
  const highest = (status: string) =>
    versions
      .filter((v) => v.skillId === skillId && v.status === status)
      .map((v) => v.semver)
      .sort(compareSemver)
      .at(-1) ?? null;
  const publishedSemver = highest("published");
  const draft = highest("draft");
  const isNewer = draft && (!publishedSemver || compareSemver(draft, publishedSemver) > 0);
  return { publishedSemver, draftSemver: isNewer ? draft : null };
}
