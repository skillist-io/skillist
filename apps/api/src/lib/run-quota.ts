import type { ExecutionPolicy } from "@skillist/contracts";
import { skillRuns, skills } from "@skillist/db/schema";
import { and, eq, gte, type SQL, sql } from "drizzle-orm";
import type { WorkerDb } from "./db";
import type { SkillRuntime } from "./skill-runtime";

const DEFAULT_POLICY: Required<ExecutionPolicy> = {
  hourlyRunLimit: 50,
  dailyRunLimit: 500,
  containerHourlyLimit: 10,
  anonymousHourlyLimit: 10,
  // Closed by default: publishing a skill publicly must not hand strangers a
  // spending key to this org's sandbox budget. Enforced in
  // lib/skill-execution-access.ts, not here — this is the default it reads.
  allowPublicRuns: false,
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
    .select({ count: sql<number>`count(*)` })
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
    .select({ count: sql<number>`count(*)` })
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
      .select({ count: sql<number>`count(*)` })
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
      .select({ count: sql<number>`count(*)` })
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

/** Thrown by `reserveRunSlot` when the atomic quota check rejects the run. */
export class RunQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunQuotaExceededError";
  }
}

export type ReserveRunInput = {
  orgId: string;
  policy: ExecutionPolicy | null | undefined;
  runtime: SkillRuntime;
  isAnonymous: boolean;
  values: typeof skillRuns.$inferInsert;
};

/**
 * Enforce the org's run quota and take a run slot.
 *
 * `checkRunQuota` alone is read-then-act: a concurrent burst all reads the same
 * count before any of them inserts, so all pass and blow past the limit. Because
 * running a PUBLIC skill spends the OWNER org's quota and sandbox compute, that
 * race is a cross-tenant denial-of-wallet, not just a self-inflicted overage.
 *
 * D1 has no locks or interactive transactions, so this inserts first and then
 * ranks: each caller counts only the rows at or before its own `rowid`. That
 * order is fixed by D1's single writer, so the first `limit` rows pass and every
 * later one sees itself over and removes its row. Ranking matters: counting all
 * rows would make concurrent callers at the boundary all back out together.
 */
export async function reserveRunSlot(
  db: WorkerDb,
  input: ReserveRunInput,
): Promise<typeof skillRuns.$inferSelect> {
  const limits = resolvePolicy(input.policy);
  const [runRow] = await db.insert(skillRuns).values(input.values).returning();
  if (!runRow) throw new Error("Failed to reserve run row");

  const hourAgo = Date.now() - 60 * 60 * 1000;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const inLastHour = sql`${skillRuns.createdAt} >= ${hourAgo}`;

  // One read for every window. Each count includes this caller's own row, so
  // `limit` runs are allowed and the next one is over.
  const [counts] = await db
    .select({
      hourly: sql<number>`count(*) filter (where ${inLastHour})`,
      daily: sql<number>`count(*)`,
      containerHourly: sql<number>`count(*) filter (where ${inLastHour} and ${skillRuns.runtime} = 'container')`,
      anonHourly: sql<number>`count(*) filter (where ${inLastHour} and ${skillRuns.actorType} = 'system')`,
    })
    .from(skillRuns)
    .innerJoin(skills, eq(skillRuns.skillId, skills.id))
    .where(
      and(
        eq(skills.orgId, input.orgId),
        sql`${skillRuns.createdAt} >= ${dayAgo}`,
        sql`${skillRuns}.rowid <= (SELECT rowid FROM ${skillRuns} WHERE ${skillRuns.id} = ${runRow.id})`,
      ),
    );

  const exceeded = quotaExceededMessage(input, limits, {
    hourly: counts?.hourly ?? 0,
    daily: counts?.daily ?? 0,
    containerHourly: counts?.containerHourly ?? 0,
    anonHourly: counts?.anonHourly ?? 0,
  });
  if (exceeded) {
    await db.delete(skillRuns).where(eq(skillRuns.id, runRow.id));
    throw new RunQuotaExceededError(exceeded);
  }
  return runRow;
}

function quotaExceededMessage(
  input: ReserveRunInput,
  limits: ReturnType<typeof resolvePolicy>,
  counts: { hourly: number; daily: number; containerHourly: number; anonHourly: number },
): string | null {
  if (counts.hourly > limits.hourlyRunLimit) {
    return `Hourly run limit (${limits.hourlyRunLimit}) exceeded for this organization`;
  }
  if (counts.daily > limits.dailyRunLimit) {
    return `Daily run limit (${limits.dailyRunLimit}) exceeded for this organization`;
  }
  if (input.runtime === "container" && counts.containerHourly > limits.containerHourlyLimit) {
    return `Container hourly limit (${limits.containerHourlyLimit}) exceeded`;
  }
  if (
    input.isAnonymous &&
    limits.anonymousHourlyLimit > 0 &&
    counts.anonHourly > limits.anonymousHourlyLimit
  ) {
    return "Anonymous run limit exceeded — sign in to continue";
  }
  return null;
}
