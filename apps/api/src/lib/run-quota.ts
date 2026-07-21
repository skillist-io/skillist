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
 * Atomically enforce the org's run quota AND insert the run reservation row.
 *
 * `checkRunQuota` on its own is a read-then-act check: concurrent runs all read
 * the same `count(*)` before any of them inserts a row, so a burst all passes
 * (TOCTOU) and blows past the limit. Because running a PUBLIC skill spends the
 * OWNER org's quota and sandbox compute, that race is a cross-tenant
 * denial-of-wallet, not just a self-inflicted overage.
 *
 * Serializing every quota decision for an org on a transaction-scoped advisory
 * lock closes the window: the second caller blocks until the first commits,
 * then its `count(*)` sees the row the first one inserted. The lock is released
 * automatically when the transaction ends (commit or abort), so a failure can't
 * leave it held.
 */
export async function reserveRunSlot(
  db: WorkerDb,
  input: ReserveRunInput,
): Promise<typeof skillRuns.$inferSelect> {
  const limits = resolvePolicy(input.policy);

  return db.transaction(async (tx) => {
    // Per-org mutex, held until this transaction commits/aborts. `hashtext`
    // maps the key to the int the advisory-lock function wants; only runs for
    // the SAME org contend, so unrelated orgs never block each other.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`run-quota:${input.orgId}`}))`);

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const countRuns = async (where: SQL | undefined): Promise<number> => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(skillRuns)
        .innerJoin(skills, eq(skillRuns.skillId, skills.id))
        .where(where);
      return row?.count ?? 0;
    };

    const hourly = await countRuns(
      and(eq(skills.orgId, input.orgId), gte(skillRuns.createdAt, hourAgo)),
    );
    if (hourly >= limits.hourlyRunLimit) {
      throw new RunQuotaExceededError(
        `Hourly run limit (${limits.hourlyRunLimit}) exceeded for this organization`,
      );
    }

    const daily = await countRuns(
      and(eq(skills.orgId, input.orgId), gte(skillRuns.createdAt, dayAgo)),
    );
    if (daily >= limits.dailyRunLimit) {
      throw new RunQuotaExceededError(
        `Daily run limit (${limits.dailyRunLimit}) exceeded for this organization`,
      );
    }

    if (input.runtime === "container") {
      const containerHourly = await countRuns(
        and(
          eq(skills.orgId, input.orgId),
          eq(skillRuns.runtime, "container"),
          gte(skillRuns.createdAt, hourAgo),
        ),
      );
      if (containerHourly >= limits.containerHourlyLimit) {
        throw new RunQuotaExceededError(
          `Container hourly limit (${limits.containerHourlyLimit}) exceeded`,
        );
      }
    }

    if (input.isAnonymous && limits.anonymousHourlyLimit > 0) {
      const anonHourly = await countRuns(
        and(
          eq(skills.orgId, input.orgId),
          eq(skillRuns.actorType, "system"),
          gte(skillRuns.createdAt, hourAgo),
        ),
      );
      if (anonHourly >= limits.anonymousHourlyLimit) {
        throw new RunQuotaExceededError("Anonymous run limit exceeded — sign in to continue");
      }
    }

    const [runRow] = await tx.insert(skillRuns).values(input.values).returning();
    if (!runRow) throw new Error("Failed to reserve run row");
    return runRow;
  });
}
