import { env, SELF } from "cloudflare:test";
import {
  apiKeys,
  organizations,
  orgMembers,
  registryEntries,
  skillRuns,
  skills,
  skillVersions,
  users,
} from "@skillist/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../env";
import { closeWorkerDb, createWorkerDb } from "../lib/db";
import { sha256 } from "../lib/r2";
import { RunQuotaExceededError, reserveRunSlot } from "../lib/run-quota";

// Regression tests for the P0 security hardening:
//   H1 — cross-tenant run-history disclosure (execution.ts run list/detail)
//   H2 — unauthenticated/unbounded telemetry ranking manipulation (observability.ts)
//   H5 — run-quota TOCTOU race / denial-of-wallet (run-quota.ts reserveRunSlot)
//
// All three touch the database, so this suite runs only when a real Postgres is
// wired (INTEGRATION_DB from TEST_DATABASE_URL). See apps/api/CLAUDE.md.

const REAL_DB = Boolean((env as Record<string, unknown>).INTEGRATION_DB);

const authHeader = (rawKey: string) => ({
  Authorization: `Bearer ${rawKey}`,
  "Content-Type": "application/json",
});

describe.skipIf(!REAL_DB)("P0 security hardening — integration (requires DB)", () => {
  let db: ReturnType<typeof createWorkerDb>;
  const suffix = crypto.randomUUID().slice(0, 8);

  // Two tenants. Org A owns a PUBLIC skill; org B is an unrelated tenant whose
  // key can run the public skill but must not read A's other run history.
  const orgAId = crypto.randomUUID();
  const orgBId = crypto.randomUUID();
  const orgASlug = `sec-a-${suffix}`;
  const userAId = `sec-user-a-${suffix}`;
  const userBId = `sec-user-b-${suffix}`;
  const keyARaw = `sk_test_a_${suffix}`;
  const keyBRaw = `sk_test_b_${suffix}`;

  let skillId = "";
  let versionId = "";
  let runByAId = "";
  let runByBId = "";

  // Separate tenant for the quota-reservation unit tests, so its run rows never
  // affect the history-scoping assertions above.
  const orgQId = crypto.randomUUID();
  let quotaSkillId = "";
  let quotaVersionId = "";

  beforeAll(async () => {
    if (!REAL_DB) return;
    db = createWorkerDb(env);

    await db.insert(users).values([
      { id: userAId, name: "A", email: `a_${suffix}@ex.test` },
      { id: userBId, name: "B", email: `b_${suffix}@ex.test` },
    ]);
    await db.insert(organizations).values([
      { id: orgAId, name: `A ${suffix}`, slug: orgASlug },
      { id: orgBId, name: `B ${suffix}`, slug: `sec-b-${suffix}` },
      { id: orgQId, name: `Q ${suffix}`, slug: `sec-q-${suffix}` },
    ]);
    await db.insert(orgMembers).values([
      { orgId: orgAId, userId: userAId, role: "owner" },
      { orgId: orgBId, userId: userBId, role: "owner" },
    ]);

    const [skill] = await db
      .insert(skills)
      .values({ orgId: orgAId, repo: "widget", visibility: "public", description: "widget" })
      .returning({ id: skills.id });
    skillId = skill?.id ?? "";

    const [version] = await db
      .insert(skillVersions)
      .values({ skillId, semver: "1.0.0", r2Prefix: `orgs/${orgAId}/skills/${skillId}/1.0.0` })
      .returning({ id: skillVersions.id });
    versionId = version?.id ?? "";
    await db
      .update(skills)
      .set({ latestPublishedVersionId: versionId })
      .where(eq(skills.id, skillId));

    // Registry entry: exists only for a published PUBLIC skill, which is exactly
    // what the telemetry gate now requires before it will move a counter.
    await db.insert(registryEntries).values({
      skillId,
      orgSlug: orgASlug,
      skillRepo: "widget",
      name: "Widget",
      description: "widget",
    });

    // Two runs of the public skill: one by org A's user, one by org B's user.
    const [runA] = await db
      .insert(skillRuns)
      .values({
        skillId,
        versionId,
        orgSlug: orgASlug,
        skillRepo: "widget",
        scriptPath: "scripts/run.sh",
        runtime: "sandbox",
        status: "completed",
        stdout: "SECRET_FROM_A",
        actorId: userAId,
        actorType: "api_key",
      })
      .returning({ id: skillRuns.id });
    runByAId = runA?.id ?? "";

    const [runB] = await db
      .insert(skillRuns)
      .values({
        skillId,
        versionId,
        orgSlug: orgASlug,
        skillRepo: "widget",
        scriptPath: "scripts/run.sh",
        runtime: "sandbox",
        status: "completed",
        stdout: "SECRET_FROM_B",
        actorId: userBId,
        actorType: "api_key",
      })
      .returning({ id: skillRuns.id });
    runByBId = runB?.id ?? "";

    await db.insert(apiKeys).values([
      {
        orgId: orgAId,
        name: "a",
        keyHash: await sha256(keyARaw),
        keyPrefix: "sk_test",
        scopes: ["skills:read", "skills:run"],
        createdBy: userAId,
      },
      {
        orgId: orgBId,
        name: "b",
        keyHash: await sha256(keyBRaw),
        keyPrefix: "sk_test",
        scopes: ["skills:read", "skills:run"],
        createdBy: userBId,
      },
    ]);

    // Quota tenant: skill + version to hang reservation rows off of.
    const [qSkill] = await db
      .insert(skills)
      .values({ orgId: orgQId, repo: "quota", visibility: "public", description: "q" })
      .returning({ id: skills.id });
    quotaSkillId = qSkill?.id ?? "";
    const [qVersion] = await db
      .insert(skillVersions)
      .values({
        skillId: quotaSkillId,
        semver: "1.0.0",
        r2Prefix: `orgs/${orgQId}/skills/${quotaSkillId}/1.0.0`,
      })
      .returning({ id: skillVersions.id });
    quotaVersionId = qVersion?.id ?? "";
  });

  afterAll(async () => {
    if (!REAL_DB || !db) return;
    await db.delete(organizations).where(eq(organizations.id, orgAId));
    await db.delete(organizations).where(eq(organizations.id, orgBId));
    await db.delete(organizations).where(eq(organizations.id, orgQId));
    await db.delete(users).where(eq(users.id, userAId));
    await db.delete(users).where(eq(users.id, userBId));
    await closeWorkerDb(db);
  });

  // ---- H1: run-history tenant isolation ----------------------------------

  it("H1: a non-member key sees only its OWN runs of a public skill", async () => {
    const res = await SELF.fetch(`http://localhost/${orgASlug}/widget/runs`, {
      headers: authHeader(keyBRaw),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; stdout: string | null }[] };
    const ids = body.items.map((r) => r.id);
    expect(ids).toContain(runByBId);
    expect(ids).not.toContain(runByAId);
    // Org A's run output never reaches org B.
    expect(body.items.some((r) => r.stdout === "SECRET_FROM_A")).toBe(false);
  });

  it("H1: an owning-org key sees the full run history", async () => {
    const res = await SELF.fetch(`http://localhost/${orgASlug}/widget/runs`, {
      headers: authHeader(keyARaw),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[] };
    const ids = body.items.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([runByAId, runByBId]));
  });

  it("H1: a non-member key cannot read another actor's run detail (404)", async () => {
    const forbidden = await SELF.fetch(`http://localhost/runs/${runByAId}`, {
      headers: authHeader(keyBRaw),
    });
    expect(forbidden.status).toBe(404);

    const own = await SELF.fetch(`http://localhost/runs/${runByBId}`, {
      headers: authHeader(keyBRaw),
    });
    expect(own.status).toBe(200);
  });

  // ---- H2: telemetry authz + dedupe --------------------------------------

  it("H2: telemetry for a non-existent registry entry is rejected (404)", async () => {
    const res = await SELF.fetch("http://localhost/v1/telemetry", {
      method: "POST",
      headers: authHeader(keyARaw),
      body: JSON.stringify({
        orgSlug: orgASlug,
        skillRepo: "does-not-exist",
        eventType: "install",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("H2: repeated telemetry from one actor moves the counter at most once/day", async () => {
    const readCount = async () => {
      const [row] = await db
        .select({ installCount: registryEntries.installCount })
        .from(registryEntries)
        .where(and(eq(registryEntries.orgSlug, orgASlug), eq(registryEntries.skillRepo, "widget")))
        .limit(1);
      return row?.installCount ?? 0;
    };

    const before = await readCount();
    const post = () =>
      SELF.fetch("http://localhost/v1/telemetry", {
        method: "POST",
        headers: authHeader(keyARaw),
        body: JSON.stringify({ orgSlug: orgASlug, skillRepo: "widget", eventType: "install" }),
      });

    expect((await post()).status).toBe(201);
    const afterFirst = await readCount();
    expect(afterFirst).toBe(before + 1);

    // Same actor, same skill, same day — the counter must not move again even
    // though the raw event row is still recorded.
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect(await readCount()).toBe(afterFirst);
  });

  // ---- H5: atomic quota reservation --------------------------------------

  const reserveValues = () => ({
    skillId: quotaSkillId,
    versionId: quotaVersionId,
    orgSlug: `sec-q-${suffix}`,
    skillRepo: "quota",
    scriptPath: "scripts/run.sh",
    runtime: "sandbox" as const,
    status: "running" as const,
    actorId: null,
    actorType: "system" as const,
  });

  it("H5: reserveRunSlot enforces the hourly limit", async () => {
    const policy = { hourlyRunLimit: 2 };
    await reserveRunSlot(db, {
      orgId: orgQId,
      policy,
      runtime: "sandbox",
      isAnonymous: false,
      values: reserveValues(),
    });
    await reserveRunSlot(db, {
      orgId: orgQId,
      policy,
      runtime: "sandbox",
      isAnonymous: false,
      values: reserveValues(),
    });
    await expect(
      reserveRunSlot(db, {
        orgId: orgQId,
        policy,
        runtime: "sandbox",
        isAnonymous: false,
        values: reserveValues(),
      }),
    ).rejects.toBeInstanceOf(RunQuotaExceededError);
  });

  it("H5: concurrent reservations cannot exceed the limit (no TOCTOU overshoot)", async () => {
    // Fresh org so the prior test's rows don't count against this window.
    const raceOrgId = crypto.randomUUID();
    await db.insert(organizations).values({ id: raceOrgId, name: "race", slug: `race-${suffix}` });
    const [raceSkill] = await db
      .insert(skills)
      .values({ orgId: raceOrgId, repo: "race", visibility: "public", description: "r" })
      .returning({ id: skills.id });
    const [raceVersion] = await db
      .insert(skillVersions)
      .values({
        skillId: raceSkill?.id ?? "",
        semver: "1.0.0",
        r2Prefix: `orgs/${raceOrgId}/skills/${raceSkill?.id}/1.0.0`,
      })
      .returning({ id: skillVersions.id });

    const LIMIT = 3;
    const CONCURRENCY = 8;
    // Each contender needs its OWN connection (postgres-js is max:1 per client),
    // otherwise they'd serialize in the driver and never truly race the DB.
    const clients = Array.from({ length: CONCURRENCY }, () =>
      createWorkerDb(env as unknown as Env),
    );
    try {
      const results = await Promise.allSettled(
        clients.map((client) =>
          reserveRunSlot(client, {
            orgId: raceOrgId,
            policy: { hourlyRunLimit: LIMIT },
            runtime: "sandbox",
            isAnonymous: false,
            values: {
              skillId: raceSkill?.id ?? "",
              versionId: raceVersion?.id ?? "",
              orgSlug: `race-${suffix}`,
              skillRepo: "race",
              scriptPath: "scripts/run.sh",
              runtime: "sandbox",
              status: "running",
              actorId: null,
              actorType: "system",
            },
          }),
        ),
      );

      const granted = results.filter((r) => r.status === "fulfilled").length;
      expect(granted).toBe(LIMIT);

      // The DB must agree: exactly LIMIT reservation rows exist.
      const [{ count }] = await db
        .select({ count: skillRuns.id })
        .from(skillRuns)
        .where(eq(skillRuns.skillId, raceSkill?.id ?? ""))
        .then((rows) => [{ count: rows.length }]);
      expect(count).toBe(LIMIT);
    } finally {
      await Promise.all(clients.map((client) => closeWorkerDb(client)));
      await db.delete(organizations).where(eq(organizations.id, raceOrgId));
    }
  });
});
