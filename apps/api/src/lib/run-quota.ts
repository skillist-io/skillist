import { and, eq, gte, sql } from "drizzle-orm";
import type { ExecutionPolicy } from "@skillist/contracts";
import { skillRuns, skills } from "@skillist/db/schema";
import type { WorkerDb } from "./db";
import type { SkillRuntime } from "./skill-runtime";

const DEFAULT_POLICY: Required<ExecutionPolicy> = {
  hourlyRunLimit: 50,
  dailyRunLimit: 500,
  containerHourlyLimit: 10,
  anonymousHourlyLimit: 10,
};

function resolvePolicy(policy?: ExecutionPolicy | null): Required<ExecutionPolicy> {
  return { ...DEFAULT_POLICY, ...policy };
}

export async function checkRunQuota(
  db: WorkerDb,
  orgId: string,
  policy: ExecutionPolicy | null | undefined,
  runtime: SkillRuntime,
  isAnonymous: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const limits = resolvePolicy(policy);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const orgFilter = and(eq(skills.orgId, orgId), gte(skillRuns.createdAt, hourAgo));

  const [hourly] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(skillRuns)
    .innerJoin(skills, eq(skillRuns.skillId, skills.id))
    .where(orgFilter);

  const hourlyCount = hourly?.count ?? 0;
  if (hourlyCount >= limits.hourlyRunLimit) {
    return {
      ok: false,
      message: `Hourly run limit (${limits.hourlyRunLimit}) exceeded for this organization`,
    };
  }

  const [daily] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(skillRuns)
    .innerJoin(skills, eq(skillRuns.skillId, skills.id))
    .where(and(eq(skills.orgId, orgId), gte(skillRuns.createdAt, dayAgo)));

  const dailyCount = daily?.count ?? 0;
  if (dailyCount >= limits.dailyRunLimit) {
    return {
      ok: false,
      message: `Daily run limit (${limits.dailyRunLimit}) exceeded for this organization`,
    };
  }

  if (runtime === "container") {
    const [containerHourly] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(skillRuns)
      .innerJoin(skills, eq(skillRuns.skillId, skills.id))
      .where(
        and(
          eq(skills.orgId, orgId),
          eq(skillRuns.runtime, "container"),
          gte(skillRuns.createdAt, hourAgo),
        ),
      );

    const containerCount = containerHourly?.count ?? 0;
    if (containerCount >= limits.containerHourlyLimit) {
      return {
        ok: false,
        message: `Container hourly limit (${limits.containerHourlyLimit}) exceeded`,
      };
    }
  }

  if (isAnonymous && limits.anonymousHourlyLimit > 0) {
    const [anonHourly] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(skillRuns)
      .innerJoin(skills, eq(skillRuns.skillId, skills.id))
      .where(
        and(
          eq(skills.orgId, orgId),
          eq(skillRuns.actorType, "system"),
          gte(skillRuns.createdAt, hourAgo),
        ),
      );

    const anonCount = anonHourly?.count ?? 0;
    if (anonCount >= limits.anonymousHourlyLimit) {
      return {
        ok: false,
        message: "Anonymous run limit exceeded — sign in to continue",
      };
    }
  }

  return { ok: true };
}
